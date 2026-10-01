// 架空の試料を作る（node tests/fixtures/synthetic/make.cjs）。本物の会話は使わない。
// 形は公開の変換器の資料に合わせた: ChatGPT は mohamed-chs/convoviz の docs/dev/chatgpt-spec.md と tests/conftest.py、
// Claude は davidteren/claude_desktop_export_browser の test_current_branch.py・test_message_text.py と
// sugurutakahashi-1234/ai-chat-md-export の src/infrastructure/parsers/claude/schema.ts（README「読む形式」）
const fs = require('fs');
const path = require('path');
const T = 1767225600; // 2026-01-01T00:00:00Z
function msg(id, role, content, dt, extra = {}) {
  return { id, author: { role, name: null, metadata: {} }, create_time: T + dt, update_time: T + dt, content, status: 'finished_successfully', end_turn: true, weight: 1, metadata: extra.metadata || {}, recipient: extra.recipient || 'all' };
}
function node(id, parent, children, message) { return { id, parent, children, message }; }
const text = (s) => ({ content_type: 'text', parts: [s] });

// 1) 枝分かれ（編集・再生成）・システム・隠れた発言・コード実行・画像・添付・考えの要約・モデル名
const branched = {
  title: 'Branch test: edit and regenerate',
  create_time: T, update_time: T + 600, conversation_id: 'gpt-branch-0001', id: 'gpt-branch-0001',
  current_node: 'a3', default_model_slug: 'model-default',
  mapping: {
    root: node('root', null, ['sys'], null),
    sys: node('sys', 'root', ['u1'], msg('sys', 'system', text('hidden system prompt'), 0)),
    u1: node('u1', 'sys', ['a1old', 'a1'], msg('u1', 'user', text('First question'), 10)),
    a1old: node('a1old', 'u1', [], msg('a1old', 'assistant', text('OLD ANSWER (regenerated away)'), 20, { metadata: { model_slug: 'model-a' } })),
    a1: node('a1', 'u1', ['u2old', 'u2'], msg('a1', 'assistant', text('Answer one'), 30, { metadata: { model_slug: 'model-a' } })),
    u2old: node('u2old', 'a1', ['a2old'], msg('u2old', 'user', text('OLD EDIT of question two'), 40)),
    a2old: node('a2old', 'u2old', [], msg('a2old', 'assistant', text('OLD reply to old edit'), 50)),
    u2: node('u2', 'a1', ['th'], msg('u2', 'user', { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_00000000abc', size_bytes: 1, width: 1, height: 1 }, 'What is in this picture?'] }, 60, { metadata: { attachments: [{ id: 'file-xyz', name: 'report.pdf', mime_type: 'application/pdf' }] } })),
    th: node('th', 'u2', ['code'], msg('th', 'assistant', { content_type: 'thoughts', thoughts: [{ summary: 'thinking', content: 'HIDDEN THOUGHT' }] }, 65)),
    code: node('code', 'th', ['out'], msg('code', 'assistant', { content_type: 'code', language: 'python', text: 'print("hi")\n```inner```' }, 70, { recipient: 'python' })),
    out: node('out', 'code', ['hid'], msg('out', 'tool', { content_type: 'execution_output', text: 'hi' }, 80)),
    hid: node('hid', 'out', ['a3'], msg('hid', 'assistant', text('HIDDEN visually'), 85, { metadata: { is_visually_hidden_from_conversation: true } })),
    a3: node('a3', 'hid', [], msg('a3', 'assistant', text('Final answer with code:\n\n```js\nconsole.log(1)\n```'), 90, { metadata: { model_slug: 'model-b' } })),
  },
};
// 2) 題名なし・時刻なし（create_time が null）・知らない content_type
const untitled = {
  title: null, create_time: null, update_time: null, conversation_id: 'gpt-untitled-0002', current_node: 'b2',
  mapping: {
    b0: node('b0', null, ['b1'], null),
    b1: node('b1', 'b0', ['b2'], { ...msg('b1', 'user', text('No title here'), 0), create_time: null }),
    b2: node('b2', 'b1', [], { ...msg('b2', 'assistant', { content_type: 'future_type_x', parts: ['Text in an unknown type'] }, 0), create_time: null }),
  },
};
// 3) 題名に使えない文字・同じ題名
const naughty = (id, dt) => ({
  title: 'CON: a/b\\c *?"<>|#^[x]. ', create_time: T + dt, update_time: T + dt, conversation_id: id, current_node: 'c1',
  mapping: { c0: node('c0', null, ['c1'], null), c1: node('c1', 'c0', [], msg('c1', 'user', text('reserved name test'), dt)) },
});
fs.writeFileSync(path.join(__dirname, 'chatgpt-conversations.json'), JSON.stringify([branched, untitled, naughty('gpt-name-0003', 100), naughty('gpt-name-0004', 200)], null, 1));
// 分かれた形（conversations-000.json・-001.json。convoviz の tests/conftest.py の mock_multi_zip_file と同じ形）
fs.writeFileSync(path.join(__dirname, 'conversations-000.json'), JSON.stringify([branched]));
fs.writeFileSync(path.join(__dirname, 'conversations-001.json'), JSON.stringify([untitled]));

// Claude
const C0 = '2026-02-01T00:00:00Z';
const at = (min) => new Date(Date.parse(C0) + min * 60000).toISOString();
const claudeBranch = {
  uuid: 'claude-branch-0001', name: 'Claude branch test', summary: '', created_at: C0, updated_at: at(30),
  current_leaf_message_uuid: 'm5',
  chat_messages: [
    { uuid: 'm1', parent_message_uuid: '00000000-0000-4000-8000-000000000000', sender: 'human', created_at: at(0), text: 'Hello', content: [{ type: 'text', text: 'Hello' }], attachments: [{ file_name: 'notes.txt', file_size: 10, file_type: 'txt', extracted_content: 'SECRET EXTRACTED TEXT' }], files: [{ file_name: 'photo.png' }] },
    { uuid: 'm2old', parent_message_uuid: 'm1', sender: 'assistant', created_at: at(1), text: 'OLD RETRY', content: [{ type: 'text', text: 'OLD RETRY' }], attachments: [], files: [] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', created_at: at(2), text: 'Let me check.This block is not supported on your current device yet.Done.', content: [
      { type: 'thinking', thinking: 'HIDDEN THINKING' },
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', name: 'web_search', input: { query: 'x' } },
      { type: 'tool_result', content: [{ type: 'text', text: 'RAW TOOL OUTPUT' }] },
      { type: 'text', text: 'Done.\n\n```bash\necho ok\n```' },
    ], attachments: [], files: [] },
    { uuid: 'm3', parent_message_uuid: 'm2', sender: 'human', created_at: at(3), text: 'Thanks', content: [{ type: 'text', text: 'Thanks' }], attachments: [], files: [] },
    { uuid: 'm4old', parent_message_uuid: 'm3', sender: 'assistant', created_at: at(4), text: 'OLD SHORT', content: [{ type: 'text', text: 'OLD SHORT' }], attachments: [], files: [] },
    { uuid: 'm4', parent_message_uuid: 'm3', sender: 'assistant', created_at: at(5), text: 'You are welcome.', content: [{ type: 'text', text: 'You are welcome.' }], attachments: [], files: [] },
    { uuid: 'm5', parent_message_uuid: 'm4', sender: 'human', created_at: at(6), text: 'Bye', content: [{ type: 'text', text: 'Bye' }], attachments: [], files: [] },
  ],
};
// 古い形（content が無く text だけ。parent も無い）。順番は created_at で並べ直す
const claudeFlat = {
  uuid: 'claude-flat-0002', name: '', created_at: at(100), updated_at: at(110),
  chat_messages: [
    { uuid: 'f2', sender: 'assistant', created_at: at(101), text: 'Second (answer)', attachments: [], files: [] },
    { uuid: 'f1', sender: 'human', created_at: at(100), text: 'First (question)', attachments: [], files: [] },
    { uuid: 'f3', sender: 'assistant', created_at: at(102), text: '```\nThis block is not supported on your current device yet.\n```\nAfter tool', attachments: [], files: [] },
  ],
};
fs.writeFileSync(path.join(__dirname, 'claude-conversations.json'), JSON.stringify([claudeBranch, claudeFlat], null, 2));

// 壊れたファイル: 2 つ目の会話の 9 行目あたりで JSON が壊れている
fs.writeFileSync(path.join(__dirname, 'broken-conversations.json'),
  '[\n  {"uuid":"ok-1","name":"ok","created_at":"2026-03-01T00:00:00Z","chat_messages":[{"sender":"human","text":"hi"}]},\n' +
  '  {\n    "uuid": "bad-2",\n    "name": "bad",\n    "created_at": "2026-03-02T00:00:00Z",\n    "chat_messages": [\n      {"sender": "human", "text": "x"}\n      {"sender": "assistant"}\n    ]\n  },\n' +
  '  {"something":"else"},\n' +
  '  {"uuid":"ok-3","name":"ok3","created_at":"2026-03-03T00:00:00Z","chat_messages":[{"sender":"human","text":"hi3"}]}\n]\n');
console.log('ok');
