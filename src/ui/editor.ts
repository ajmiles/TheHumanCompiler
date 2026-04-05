// ── Monaco Editor Setup with AMD ASM Language ──

import * as monaco from 'monaco-editor';
import { getAllMnemonics, getAllOpcodes, lookupByMnemonic } from '../isa/opcodes';
import { InstructionFormat } from '../isa/types';

self.MonacoEnvironment = {
  getWorker(_: unknown, _label: string) {
    return new Worker(
      new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      { type: 'module' },
    );
  },
};

const LANG_ID = 'amdasm';
let registered = false;

function registerLanguage(): void {
  if (registered) return;
  registered = true;

  const mnemonics = getAllMnemonics();
  const allOps = getAllOpcodes();

  // Categorize mnemonics by instruction type for color coding
  const valuMnemonics: string[] = [];
  const saluMnemonics: string[] = [];
  const soppMnemonics: string[] = [];
  const vmemMnemonics: string[] = [];
  const smemMnemonics: string[] = [];
  const dsMnemonics: string[] = [];

  for (const op of allOps) {
    switch (op.format) {
      case InstructionFormat.VOP1:
      case InstructionFormat.VOP2:
      case InstructionFormat.VOP3:
      case InstructionFormat.VOP3P:
      case InstructionFormat.VOPC:
        valuMnemonics.push(op.mnemonic);
        break;
      case InstructionFormat.SOP1:
      case InstructionFormat.SOP2:
      case InstructionFormat.SOPC:
      case InstructionFormat.SOPK:
        saluMnemonics.push(op.mnemonic);
        break;
      case InstructionFormat.SOPP:
        soppMnemonics.push(op.mnemonic);
        break;
      case InstructionFormat.MUBUF:
      case InstructionFormat.MTBUF:
      case InstructionFormat.MIMG:
        vmemMnemonics.push(op.mnemonic);
        break;
      case InstructionFormat.SMEM:
        smemMnemonics.push(op.mnemonic);
        break;
      case InstructionFormat.DS:
        dsMnemonics.push(op.mnemonic);
        break;
    }
  }

  monaco.languages.register({ id: LANG_ID });

  monaco.languages.setMonarchTokensProvider(LANG_ID, {
    valu: valuMnemonics,
    salu: saluMnemonics,
    sopp: soppMnemonics,
    vmem: vmemMnemonics,
    smem: smemMnemonics,
    ds: dsMnemonics,
    tokenizer: {
      root: [
        // Comments
        [/;.*$/, 'comment'],
        // Hex numbers
        [/-?0[xX][0-9a-fA-F]+/, 'number.hex'],
        // Float numbers
        [/-?\d+\.\d*/, 'number.float'],
        // Integer numbers
        [/-?\d+/, 'number'],
        // Registers v0-v255, s0-s105
        [/\b[vs]\d+\b/, 'register'],
        // Mnemonics / identifiers — classify by category
        [/[a-z_][a-z0-9_]*/, {
          cases: {
            '@valu': 'keyword.valu',
            '@salu': 'keyword.salu',
            '@sopp': 'keyword.sopp',
            '@vmem': 'keyword.vmem',
            '@smem': 'keyword.smem',
            '@ds': 'keyword.ds',
            '@default': 'identifier',
          },
        }],
        // Commas
        [/,/, 'delimiter.comma'],
        // Whitespace
        [/\s+/, 'white'],
      ],
    },
  });

  monaco.editor.defineTheme('amdasm-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.valu', foreground: '39d353', fontStyle: 'bold' },   // Green — VALU
      { token: 'keyword.salu', foreground: '58a6ff', fontStyle: 'bold' },   // Blue — SALU
      { token: 'keyword.sopp', foreground: 'd29922', fontStyle: 'bold' },   // Yellow — SOPP
      { token: 'keyword.vmem', foreground: 'db6d28', fontStyle: 'bold' },   // Orange — VMEM
      { token: 'keyword.smem', foreground: '39c5cf', fontStyle: 'bold' },   // Cyan — SMEM
      { token: 'keyword.ds', foreground: 'f85149', fontStyle: 'bold' },     // Red — DS/LDS
      { token: 'keyword', foreground: '39d353', fontStyle: 'bold' },        // Fallback green
      { token: 'register', foreground: '39c5cf' },
      { token: 'number', foreground: 'd29922' },
      { token: 'number.hex', foreground: 'd29922' },
      { token: 'number.float', foreground: 'd29922' },
      { token: 'comment', foreground: '484f58', fontStyle: 'italic' },
      { token: 'delimiter.comma', foreground: '8b949e' },
      { token: 'identifier', foreground: 'e6edf3' },
    ],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#e6edf3',
      'editor.lineHighlightBackground': '#161b2280',
      'editor.selectionBackground': '#264f7844',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#8b949e',
      'editorCursor.foreground': '#58a6ff',
      'editorGutter.background': '#0d1117',
    },
  });

  monaco.languages.registerCompletionItemProvider(LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];

      for (const m of mnemonics) {
        const info = lookupByMnemonic(m);
        suggestions.push({
          label: m,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: m,
          detail: info?.syntax,
          documentation: info?.description,
          range,
        });
      }

      // Register suggestions
      for (let i = 0; i < 16; i++) {
        suggestions.push({
          label: `v${i}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `v${i}`,
          range,
        });
      }
      for (let i = 0; i < 8; i++) {
        suggestions.push({
          label: `s${i}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `s${i}`,
          range,
        });
      }

      return { suggestions };
    },
  });

  // Hover tooltips for instructions
  monaco.languages.registerHoverProvider(LANG_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const info = lookupByMnemonic(word.word);
      if (info) {
        return {
          range: new monaco.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          ),
          contents: [
            { value: `**${info.mnemonic}** — ${info.format} (opcode 0x${info.opcode.toString(16).padStart(2, '0')})` },
            { value: '```\n' + info.syntax + '\n```' },
            { value: info.description },
          ],
        };
      }

      // Register hover
      const lower = word.word.toLowerCase();
      const vMatch = lower.match(/^v(\d+)$/);
      if (vMatch) {
        const idx = parseInt(vMatch[1], 10);
        return {
          range: new monaco.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          ),
          contents: [
            { value: `**v${idx}** — Vector General Purpose Register` },
            { value: `32-lane VGPR. Each lane holds an independent 32-bit float/int value.\nUsable as destination, src0 (9-bit encoded), or vsrc1 (8-bit, VOP2 only).` },
          ],
        };
      }

      const sMatch = lower.match(/^s(\d+)$/);
      if (sMatch) {
        const idx = parseInt(sMatch[1], 10);
        return {
          range: new monaco.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          ),
          contents: [
            { value: `**s${idx}** — Scalar General Purpose Register` },
            { value: `Scalar register shared across all 32 lanes.\nCan only be used as src0 (not as destination or vsrc1 in vector instructions).` },
          ],
        };
      }

      return null;
    },
  });
}

export class AsmEditor {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private decorations: monaco.editor.IEditorDecorationsCollection;

  constructor(container: HTMLElement) {
    registerLanguage();

    this.editor = monaco.editor.create(container, {
      value: '; Write your AMD assembly here\n',
      language: LANG_ID,
      theme: 'amdasm-dark',
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      automaticLayout: true,
      padding: { top: 8 },
      tabSize: 2,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });

    this.decorations = this.editor.createDecorationsCollection([]);
  }

  getSource(): string {
    return this.editor.getValue();
  }

  setSource(source: string): void {
    this.editor.setValue(source);
  }

  highlightLine(line: number): void {
    this.decorations.set([{
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'exec-line-highlight',
        glyphMarginClassName: 'exec-line-glyph',
      },
    }]);
    this.editor.revealLineInCenterIfOutsideViewport(line);
  }

  clearHighlight(): void {
    this.decorations.set([]);
  }

  onContentChange(callback: () => void): void {
    this.editor.onDidChangeModelContent(() => callback());
  }

  onCursorChange(callback: (line: number) => void): void {
    this.editor.onDidChangeCursorPosition((e) => {
      callback(e.position.lineNumber);
    });
  }

  getCursorLine(): number {
    return this.editor.getPosition()?.lineNumber ?? 1;
  }

  revealLine(line: number): void {
    this.editor.revealLineInCenterIfOutsideViewport(line);
    this.editor.setPosition({ lineNumber: line, column: 1 });
    this.editor.focus();
  }

  setErrors(errors: { line: number; column: number; message: string }[]): void {
    const model = this.editor.getModel();
    if (!model) return;

    const markers: monaco.editor.IMarkerData[] = errors.map(e => ({
      severity: monaco.MarkerSeverity.Error,
      message: e.message,
      startLineNumber: e.line,
      startColumn: e.column,
      endLineNumber: e.line,
      endColumn: e.column + 10,
    }));

    monaco.editor.setModelMarkers(model, 'amdasm', markers);
  }
}
