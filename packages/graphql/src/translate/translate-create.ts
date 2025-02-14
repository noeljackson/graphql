/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import camelCase from "camelcase";
import pluralize from "pluralize";
import { Node } from "../classes";
import createProjectionAndParams from "./create-projection-and-params";
import createCreateAndParams from "./create-create-and-params";
import { Context } from "../types";
import { AUTH_FORBIDDEN_ERROR } from "../constants";

function translateCreate({ context, node }: { context: Context; node: Node }): [string, any] {
    const { resolveTree } = context;

    const { fieldsByTypeName } = resolveTree.fieldsByTypeName[`Create${pluralize(node.name)}MutationResponse`][
        pluralize(camelCase(node.name))
    ];

    const { createStrs, params } = (resolveTree.args.input as any[]).reduce(
        (res, input, index) => {
            const varName = `this${index}`;

            const create = [`CALL {`];

            const createAndParams = createCreateAndParams({
                input,
                node,
                context,
                varName,
                withVars: [varName],
            });
            create.push(`${createAndParams[0]}`);
            create.push(`RETURN ${varName}`);
            create.push(`}`);

            res.createStrs.push(create.join("\n"));
            res.params = { ...res.params, ...createAndParams[1] };

            return res;
        },
        { createStrs: [], params: {}, withVars: [] }
    ) as {
        createStrs: string[];
        params: any;
    };

    /* so projection params don't conflict with create params. We only need to call createProjectionAndParams once. */
    let projAuth = "";
    const projection = createProjectionAndParams({
        node,
        context,
        fieldsByTypeName,
        varName: "REPLACE_ME",
    });
    if (projection[2]?.authValidateStrs?.length) {
        projAuth = `CALL apoc.util.validate(NOT(${projection[2].authValidateStrs.join(
            " AND "
        )}), "${AUTH_FORBIDDEN_ERROR}", [0])`;
    }

    const replacedProjectionParams = Object.entries(projection[1]).reduce((res, [key, value]) => {
        return { ...res, [key.replace("REPLACE_ME", "projection")]: value };
    }, {});

    const projectionStr = createStrs
        .map(
            (_, i) =>
                `\nthis${i} ${projection[0]
                    .replace(/\$REPLACE_ME/g, "$projection")
                    .replace(/REPLACE_ME/g, `this${i}`)} AS this${i}`
        )
        .join(", ");

    const authCalls = createStrs
        .map((_, i) => projAuth.replace(/\$REPLACE_ME/g, "$projection").replace(/REPLACE_ME/g, `this${i}`))
        .join("\n");

    const cypher = [`${createStrs.join("\n")}`, authCalls, `\nRETURN ${projectionStr}`];

    return [cypher.filter(Boolean).join("\n"), { ...params, ...replacedProjectionParams }];
}

export default translateCreate;
