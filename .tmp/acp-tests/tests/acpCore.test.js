"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const acpCore_1 = require("../src/main/services/acpCore");
(0, node_test_1.test)('isWithin: child path inside workspace', () => {
    strict_1.default.equal((0, acpCore_1.isWithin)('/a/b', '/a/b'), true);
    strict_1.default.equal((0, acpCore_1.isWithin)('/a/b', '/a/b/c'), true);
    strict_1.default.equal((0, acpCore_1.isWithin)('/a/b', '/a/b/c/d'), true);
    strict_1.default.equal((0, acpCore_1.isWithin)('/a/b', '/a/x'), false);
});
(0, node_test_1.test)('resolvePathInWorkspace: relative joins, absolute preserved', () => {
    strict_1.default.equal((0, acpCore_1.resolvePathInWorkspace)('/w', 'file.txt'), '/w/file.txt');
    strict_1.default.equal((0, acpCore_1.resolvePathInWorkspace)('/w', './x/../y.txt'), '/w/y.txt');
    strict_1.default.equal((0, acpCore_1.resolvePathInWorkspace)('/w', '/abs/z.txt'), '/abs/z.txt');
});
(0, node_test_1.test)('toLines: splits by newline and keeps rest', () => {
    const r1 = (0, acpCore_1.toLines)('a\nb\nc');
    strict_1.default.deepEqual(r1.lines, ['a', 'b']);
    strict_1.default.equal(r1.rest, 'c');
    const r2 = (0, acpCore_1.toLines)('a\r\n\r\nb\r\n');
    strict_1.default.deepEqual(r2.lines, ['a', 'b']);
    strict_1.default.equal(r2.rest, '');
});
(0, node_test_1.test)('mapAcpUpdateToUiEvent: trace normalization and previews', () => {
    const evt = (0, acpCore_1.mapAcpUpdateToUiEvent)({
        type: 'tool_call',
        runId: 'r1',
        trace: {
            id: 't1',
            name: 'fs/readFile',
            status: 'running',
            args: { path: 'a.txt' }
        }
    });
    strict_1.default.ok(evt && evt.type === 'trace');
    if (!evt || evt.type !== 'trace')
        return;
    strict_1.default.equal(evt.runId, 'r1');
    strict_1.default.equal(evt.trace.id, 't1');
    strict_1.default.equal(evt.trace.name, 'fs/readFile');
    strict_1.default.equal(evt.trace.status, 'running');
    strict_1.default.equal(evt.trace.argsPreview.text.includes('a.txt'), true);
});
(0, node_test_1.test)('buildKey: stable key format', () => {
    const key = (0, acpCore_1.buildKey)('/w', 'thread', 'agent');
    strict_1.default.equal(typeof key, 'string');
    strict_1.default.equal(key.includes(':thread:agent'), true);
});
