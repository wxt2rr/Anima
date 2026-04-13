"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const slashCommands_1 = require("../src/renderer/src/lib/slashCommands");
(0, node_test_1.test)('parseSlashInput: 识别命令名、参数和建议态', () => {
    strict_1.default.deepEqual((0, slashCommands_1.parseSlashInput)('/review'), {
        raw: '/review',
        name: 'review',
        args: '',
        query: 'review',
        shouldSuggest: true,
        isCommand: true
    });
    strict_1.default.deepEqual((0, slashCommands_1.parseSlashInput)('/review login flow'), {
        raw: '/review login flow',
        name: 'review',
        args: 'login flow',
        query: 'review',
        shouldSuggest: false,
        isCommand: true
    });
    strict_1.default.equal((0, slashCommands_1.parseSlashInput)('hello world'), null);
    strict_1.default.equal((0, slashCommands_1.parseSlashInput)('/review\nmore'), null);
});
(0, node_test_1.test)('parseProjectSlashCommandFile: 从 markdown 文件生成项目命令', () => {
    const cmd = (0, slashCommands_1.parseProjectSlashCommandFile)('/repo/.anima/commands/review-diff.md', `
# Review Diff

检查当前改动，并输出风险点。

请审查以下改动：
{{args}}
`);
    strict_1.default.ok(cmd);
    strict_1.default.equal(cmd?.name, 'review-diff');
    strict_1.default.equal(cmd?.source, 'project');
    strict_1.default.equal(cmd?.description, '检查当前改动，并输出风险点。');
    strict_1.default.equal(String(cmd?.template || '').includes('{{args}}'), true);
});
(0, node_test_1.test)('renderSlashCommandTemplate: 替换模板变量并保留未知变量原样', () => {
    const text = (0, slashCommands_1.renderSlashCommandTemplate)('审查 {{args}} @ {{workspace}} / {{unknown}}', {
        args: '登录流程',
        workspace: '/repo/demo'
    });
    strict_1.default.equal(text, '审查 登录流程 @ /repo/demo / {{unknown}}');
});
(0, node_test_1.test)('filterSlashCommands: 前缀命中优先于描述命中', () => {
    const commands = [
        {
            id: 'review',
            name: 'review',
            title: '/review',
            description: '审查当前改动',
            source: 'builtin',
            kind: 'prompt'
        },
        {
            id: 'coder-status',
            name: 'coder-status',
            title: '/coder-status',
            description: '查看 coder 状态',
            source: 'builtin',
            kind: 'action'
        },
        {
            id: 'ship-check',
            name: 'ship-check',
            title: '/ship-check',
            description: 'review release readiness',
            source: 'project',
            kind: 'prompt',
            filePath: '/repo/.anima/commands/ship-check.md',
            template: '...'
        }
    ];
    const names = (0, slashCommands_1.filterSlashCommands)(commands, 're').map((item) => item.name);
    strict_1.default.deepEqual(names, ['review', 'ship-check']);
});
