#!/usr/bin/env bun
// Convert docs/data-model/snowtime.dbml into a ChartDB diagram JSON.
//
// ChartDB's DBML importer strips TableGroup blocks and table colors before parsing, so a
// DBML import always lands as an unsorted, uncolored pile of tables. Its own diagram format
// (File > Import diagram) carries areas, colors and coordinates, so this script emits that
// instead: one colored area per TableGroup, with the group's tables laid out inside it.
//
// Usage: bun scripts/dbml-to-chartdb.mjs [input.dbml] [output.json]

import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2] ?? 'docs/data-model/snowtime.dbml';
const output = process.argv[3] ?? 'docs/data-model/snowtime.chartdb.json';

// ChartDB renders a table node at this size; the layout below needs the same numbers.
const TABLE_WIDTH = 224;
const TABLE_HEADER_HEIGHT = 42;
const FIELD_HEIGHT = 32;
const TABLE_FOOTER_HEIGHT = 32;
const MINIMIZED_FIELDS = 10;

const COL_GAP = 60;
const ROW_GAP = 48;
const AREA_PAD_X = 32;
const AREA_PAD_TOP = 64; // room for the area label
const AREA_PAD_BOTTOM = 32;
const AREA_GAP = 120;
const MAX_ROW_WIDTH = 5200;

const SCHEMA = 'main';
const CREATED_AT = 1700000000000; // fixed, so regenerating produces a clean diff

// --- DBML parsing --------------------------------------------------------------------

// Splits an attribute list on commas that are outside quotes and parentheses.
function splitAttributes(text) {
    const parts = [];
    let current = '';
    let quote = null;
    let depth = 0;
    for (const char of text) {
        if (quote) {
            if (char === quote) quote = null;
            current += char;
        } else if (char === "'" || char === '"') {
            quote = char;
            current += char;
        } else if (char === '(' || char === '[') {
            depth++;
            current += char;
        } else if (char === ')' || char === ']') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function unquote(value) {
    const match = value.match(/^'''([\s\S]*)'''$/) ?? value.match(/^'([\s\S]*)'$/) ?? value.match(/^"([\s\S]*)"$/);
    return match ? match[1] : value;
}

function parseDbml(source) {
    const tables = [];
    const groups = [];
    const lines = source.split('\n');

    let table = null;
    let inIndexes = false;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;

        if (table) {
            if (inIndexes) {
                if (line === '}') {
                    inIndexes = false;
                    continue;
                }
                table.indexes.push(parseIndex(line));
                continue;
            }
            const indexesMatch = line.match(/^indexes\s*\{(.*)$/);
            if (indexesMatch) {
                // The block is written either across several lines or on one.
                const rest = indexesMatch[1].trim();
                if (rest.endsWith('}')) {
                    table.indexes.push(parseIndex(rest.slice(0, -1).trim()));
                } else {
                    inIndexes = true;
                }
                continue;
            }
            if (line === '}') {
                tables.push(table);
                table = null;
                continue;
            }
            const match = line.match(/^([a-z_][\w]*)\s+([a-z_][\w ]*?)(\(([^)]*)\))?\s*(?:\[(.*)\])?$/i);
            if (!match) throw new Error(`Unparsed column line: ${line}`);
            const attributes = match[5] ? splitAttributes(match[5]) : [];
            const defaultAttribute = attributes.find((a) => a.startsWith('default:'));
            const refAttribute = attributes.find((a) => a.startsWith('ref:'));
            table.fields.push({
                name: match[1],
                type: match[2].trim(),
                arguments: match[4] ? match[4].split(',').map((a) => a.trim()) : [],
                primaryKey: attributes.includes('pk'),
                unique: attributes.includes('unique'),
                notNull: attributes.includes('not null') || attributes.includes('pk'),
                default: defaultAttribute ? defaultAttribute.slice('default:'.length).trim() : null,
                ref: refAttribute ? parseRef(refAttribute) : null,
                note: noteOf(attributes),
            });
            continue;
        }

        const tableMatch = line.match(/^Table\s+"?([\w.]+)"?\s*(?:\[(.*)\])?\s*\{$/);
        if (tableMatch) {
            table = {
                name: tableMatch[1],
                note: tableMatch[2] ? noteOf(splitAttributes(tableMatch[2])) : null,
                fields: [],
                indexes: [],
            };
            continue;
        }

        const groupMatch = line.match(/^TableGroup\s+"?([\w ]+)"?\s*(?:\[(.*)\])?\s*\{$/);
        if (groupMatch) {
            const attributes = groupMatch[2] ? splitAttributes(groupMatch[2]) : [];
            const color = attributes.find((a) => a.startsWith('color:'));
            groups.push({
                name: groupMatch[1].trim(),
                color: color ? color.slice('color:'.length).trim() : null,
                tables: [],
            });
            continue;
        }

        if (groups.length && !groups.at(-1).closed) {
            const group = groups.at(-1);
            if (line === '}') group.closed = true;
            else group.tables.push(line);
        }
    }

    return { tables, groups };
}

function parseIndex(line) {
    const match = line.match(/^(\(([^)]*)\)|[a-z_][\w]*)\s*(?:\[(.*)\])?$/i);
    if (!match) throw new Error(`Unparsed index line: ${line}`);
    const attributes = match[3] ? splitAttributes(match[3]) : [];
    const primaryKey = attributes.includes('pk');
    return {
        columns: (match[2] ?? match[1]).split(',').map((c) => c.trim()),
        unique: attributes.includes('unique') || primaryKey,
        primaryKey,
        note: noteOf(attributes),
    };
}

function noteOf(attributes) {
    const note = attributes.find((a) => a.startsWith('note:'));
    return note ? unquote(note.slice('note:'.length).trim()) : null;
}

// Only the many-to-one form (`ref: > table.column`) appears in this model.
function parseRef(attribute) {
    const match = attribute.match(/^ref:\s*([<>-])\s*"?([\w.]+)"?\.\s*"?(\w+)"?$/);
    if (!match) throw new Error(`Unparsed ref: ${attribute}`);
    return { relation: match[1], table: match[2], column: match[3] };
}

// --- ChartDB model -------------------------------------------------------------------

function tableHeight(fieldCount) {
    const visible = Math.min(fieldCount, MINIMIZED_FIELDS);
    return (
        TABLE_HEADER_HEIGHT +
        visible * FIELD_HEIGHT +
        (fieldCount > MINIMIZED_FIELDS ? TABLE_FOOTER_HEIGHT : 0)
    );
}

function buildTables(parsed) {
    return parsed.tables.map((table, tableIndex) => ({
        id: `t${tableIndex}`,
        name: table.name,
        schema: SCHEMA,
        x: 0,
        y: 0,
        fields: table.fields.map((field, fieldIndex) => ({
            id: `t${tableIndex}f${fieldIndex}`,
            name: field.name,
            type: { id: field.type.toLowerCase().replace(/ /g, '_'), name: field.type },
            primaryKey: field.primaryKey,
            unique: field.unique,
            nullable: !field.notNull,
            createdAt: CREATED_AT,
            characterMaximumLength:
                field.arguments.length === 1 ? field.arguments[0] : null,
            precision: field.arguments.length === 2 ? Number(field.arguments[0]) : null,
            scale: field.arguments.length === 2 ? Number(field.arguments[1]) : null,
            default: field.default,
            comments: field.note,
        })),
        indexes: table.indexes.map((index, indexIndex) => ({
            id: `t${tableIndex}i${indexIndex}`,
            name: `${table.name}_${index.columns.join('_')}_idx`,
            unique: index.unique,
            fieldIds: index.columns.map((column) => {
                const position = table.fields.findIndex((f) => f.name === column);
                if (position < 0) {
                    throw new Error(`Index on unknown column ${table.name}.${column}`);
                }
                return `t${tableIndex}f${position}`;
            }),
            createdAt: CREATED_AT,
            isPrimaryKey: index.primaryKey,
            comments: index.note,
        })),
        color: '#8eb7ff',
        isView: false,
        createdAt: CREATED_AT,
        comments: table.note,
        order: tableIndex,
    }));
}

function buildRelationships(parsed, tables) {
    const byName = new Map(tables.map((t) => [t.name, t]));
    const relationships = [];

    parsed.tables.forEach((table, tableIndex) => {
        table.fields.forEach((field, fieldIndex) => {
            if (!field.ref) return;
            const target = byName.get(field.ref.table);
            if (!target) throw new Error(`Ref to unknown table ${field.ref.table}`);
            const targetField = target.fields.find((f) => f.name === field.ref.column);
            if (!targetField) {
                throw new Error(`Ref to unknown column ${field.ref.table}.${field.ref.column}`);
            }
            relationships.push({
                id: `r${relationships.length}`,
                name: `${table.name}_${field.name}_${target.name}_${targetField.name}`,
                sourceSchema: SCHEMA,
                targetSchema: SCHEMA,
                sourceTableId: `t${tableIndex}`,
                targetTableId: target.id,
                sourceFieldId: `t${tableIndex}f${fieldIndex}`,
                targetFieldId: targetField.id,
                // The referencing side is always the many side in this model.
                sourceCardinality: 'many',
                targetCardinality: 'one',
                createdAt: CREATED_AT,
            });
        });
    });

    return relationships;
}

// Lays out each group as a grid of columns inside its own area, then flows the areas
// left to right, wrapping into a new row once they exceed MAX_ROW_WIDTH.
function layout(groups, tables) {
    const byName = new Map(tables.map((t) => [t.name, t]));
    const areas = [];
    const grouped = new Set();

    let rowX = 0;
    let rowY = 0;
    let rowHeight = 0;

    groups.forEach((group, groupIndex) => {
        const members = group.tables.map((name) => {
            const table = byName.get(name);
            if (!table) throw new Error(`TableGroup ${group.name} names unknown table ${name}`);
            grouped.add(name);
            return table;
        });

        const columnCount = Math.ceil(Math.sqrt(members.length));
        const perColumn = members.length ? Math.ceil(members.length / columnCount) : 0;
        const columnHeights = [];

        members.forEach((table, memberIndex) => {
            const column = Math.floor(memberIndex / perColumn);
            const offset = columnHeights[column] ?? 0;
            table.x = column * (TABLE_WIDTH + COL_GAP);
            table.y = offset;
            table.color = group.color ?? table.color;
            columnHeights[column] = offset + tableHeight(table.fields.length) + ROW_GAP;
        });

        const width = members.length
            ? columnCount * (TABLE_WIDTH + COL_GAP) - COL_GAP + 2 * AREA_PAD_X
            : TABLE_WIDTH + 2 * AREA_PAD_X;
        const height = members.length
            ? Math.max(...columnHeights) - ROW_GAP + AREA_PAD_TOP + AREA_PAD_BOTTOM
            : AREA_PAD_TOP + AREA_PAD_BOTTOM;

        if (rowX > 0 && rowX + width > MAX_ROW_WIDTH) {
            rowX = 0;
            rowY += rowHeight + AREA_GAP;
            rowHeight = 0;
        }

        const areaId = `a${groupIndex}`;
        members.forEach((table) => {
            table.x += rowX + AREA_PAD_X;
            table.y += rowY + AREA_PAD_TOP;
            table.parentAreaId = areaId;
        });

        areas.push({
            id: areaId,
            name: group.name.replace(/_/g, ' '),
            x: rowX,
            y: rowY,
            width,
            height,
            color: group.color ?? '#b067e9',
            order: groupIndex,
        });

        rowX += width + AREA_GAP;
        rowHeight = Math.max(rowHeight, height);
    });

    // Anything left out of a TableGroup goes in a row of its own below the areas.
    let looseX = 0;
    const looseY = rowY + rowHeight + AREA_GAP;
    for (const table of tables) {
        if (grouped.has(table.name)) continue;
        table.x = looseX;
        table.y = looseY;
        looseX += TABLE_WIDTH + COL_GAP;
    }

    return areas;
}

// --- main ----------------------------------------------------------------------------

const source = readFileSync(input, 'utf8');
const parsed = parseDbml(source);
const tables = buildTables(parsed);
const relationships = buildRelationships(parsed, tables);
const areas = layout(parsed.groups, tables);

const projectName = source.match(/^Project\s+"?([\w ]+?)"?\s*\{/m)?.[1]?.trim() ?? 'Data model';

const diagram = {
    id: 'snowtime-data-model',
    name: `${projectName} data model`,
    databaseType: 'sqlite',
    tables,
    relationships,
    areas,
    createdAt: new Date(CREATED_AT).toISOString(),
    updatedAt: new Date(CREATED_AT).toISOString(),
};

writeFileSync(output, `${JSON.stringify(diagram, null, 2)}\n`);

const ungrouped = tables.filter((t) => !t.parentAreaId).map((t) => t.name);
console.log(
    `${output}: ${tables.length} tables, ${relationships.length} relationships, ${areas.length} areas`
);
if (ungrouped.length) {
    console.log(`No TableGroup for: ${ungrouped.join(', ')}`);
}
