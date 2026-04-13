"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSlashCommandName = normalizeSlashCommandName;
exports.parseSlashInput = parseSlashInput;
exports.parseProjectSlashCommandFile = parseProjectSlashCommandFile;
exports.renderSlashCommandTemplate = renderSlashCommandTemplate;
exports.filterSlashCommands = filterSlashCommands;
const node_path_1 = __importDefault(require("node:path"));
function normalizeSlashCommandName(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/\.md$/i, '')
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
function parseSlashInput(raw) {
    const input = String(raw || '');
    if (!input.startsWith('/'))
        return null;
    if (/\r|\n/.test(input))
        return null;
    const body = input.slice(1);
    const match = body.match(/^([^\s]*)(?:\s+([\s\S]*))?$/);
    if (!match)
        return null;
    const name = normalizeSlashCommandName(match[1] || '');
    if (!name) {
        return {
            raw: input,
            name: '',
            args: '',
            query: '',
            shouldSuggest: true,
            isCommand: true
        };
    }
    const args = String(match[2] || '').trim();
    return {
        raw: input,
        name,
        args,
        query: name,
        shouldSuggest: !args,
        isCommand: true
    };
}
function compactMarkdownLine(raw) {
    return String(raw || '')
        .trim()
        .replace(/^#+\s*/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^>\s*/, '')
        .trim();
}
function parseProjectSlashCommandFile(filePath, content) {
    const base = node_path_1.default.basename(String(filePath || '').trim());
    const name = normalizeSlashCommandName(base);
    if (!name)
        return null;
    const text = String(content || '').replace(/^\uFEFF/, '').trim();
    if (!text)
        return null;
    const lines = text.split(/\r?\n/);
    let template = text;
    let description = '';
    const firstNonEmptyIndex = lines.findIndex((line) => compactMarkdownLine(line));
    if (firstNonEmptyIndex >= 0) {
        const firstLine = compactMarkdownLine(lines[firstNonEmptyIndex]);
        if (String(lines[firstNonEmptyIndex] || '').trim().startsWith('#')) {
            const remaining = lines.slice(firstNonEmptyIndex + 1);
            template = remaining.join('\n').trim();
            const descLine = remaining.find((line) => compactMarkdownLine(line));
            description = compactMarkdownLine(descLine || '');
        }
        else {
            description = firstLine;
        }
    }
    if (!template)
        return null;
    return {
        id: `project:${name}`,
        name,
        title: `/${name}`,
        description: description || `Run /${name}`,
        source: 'project',
        kind: 'prompt',
        template,
        filePath: String(filePath || '').trim()
    };
}
function renderSlashCommandTemplate(template, vars) {
    const values = {
        args: String(vars.args || '').trim(),
        workspace: String(vars.workspace || '').trim()
    };
    return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, keyRaw) => {
        const key = String(keyRaw || '').trim();
        if (!(key in values))
            return full;
        return values[key];
    });
}
function scoreSlashCommand(entry, query) {
    const q = normalizeSlashCommandName(query);
    if (!q)
        return 0;
    const haystacks = [entry.name, ...(entry.aliases || [])].map((item) => normalizeSlashCommandName(item));
    if (haystacks.some((item) => item === q))
        return 0;
    if (haystacks.some((item) => item.startsWith(q)))
        return 1;
    if (haystacks.some((item) => item.includes(q)))
        return 2;
    if (String(entry.description || '').toLowerCase().includes(q))
        return 3;
    return Number.POSITIVE_INFINITY;
}
function filterSlashCommands(commands, rawQuery) {
    const query = normalizeSlashCommandName(rawQuery);
    if (!query)
        return [...commands].sort((a, b) => a.name.localeCompare(b.name));
    return [...commands]
        .map((entry) => ({ entry, score: scoreSlashCommand(entry, query) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        return a.entry.name.localeCompare(b.entry.name);
    })
        .map((item) => item.entry);
}
