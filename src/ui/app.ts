// ── Main App Orchestrator ──

import { AsmEditor } from './editor';
import { RegisterDisplay } from './registers';
import { IOPanel } from './io-panel';
import { BinaryView } from './binary-view';
import { InstructionInfo } from './instruction-info';
import { Controls } from './controls';
import { PuzzleSelect, LevelItem, BestScore } from './puzzle-select';
import { StatusBar } from './status-bar';
import { LeaderboardOverlay, SolutionStats } from './leaderboard';
import { Encyclopedia } from './encyclopedia';

import { assemble } from '../assembler/assembler';
import { Emulator } from '../emulator/emulator';
import { Puzzle } from '../puzzle/types';
import { ALL_PUZZLES, getPuzzleById } from '../puzzle/puzzles';
import { ALL_TUTORIALS, getTutorialById, Tutorial } from '../puzzle/tutorials';
import { getLeaderboard } from '../puzzle/leaderboard';

// Build the level order: T1, P1, P2, [T2], remaining puzzles, remaining tutorials
function buildLevelOrder(): LevelItem[] {
  const levels: LevelItem[] = [];
  const usedPuzzleIds = new Set<string>();
  const usedTutorialIds = new Set<string>();

  // T1: Welcome to the GPU
  const t1 = getTutorialById('tut-welcome');
  if (t1) { levels.push({ kind: 'tutorial', data: t1 }); usedTutorialIds.add(t1.id); }

  // P1: Signal Boost, P2: Merge Streams
  for (const id of ['signal-boost', 'merge-streams']) {
    const p = getPuzzleById(id);
    if (p) { levels.push({ kind: 'puzzle', data: p }); usedPuzzleIds.add(id); }
  }

  // T2: Input/Output Modifiers (if it exists)
  const t2 = getTutorialById('tut-modifiers');
  if (t2) { levels.push({ kind: 'tutorial', data: t2 }); usedTutorialIds.add(t2.id); }

  // Remaining puzzles except deferred ones (placed after their tutorials)
  const deferredPuzzles = new Set(['quad-average', 'wave-average', 'rng-iterate']);
  for (const p of ALL_PUZZLES) {
    if (!usedPuzzleIds.has(p.id) && !deferredPuzzles.has(p.id)) {
      levels.push({ kind: 'puzzle', data: p });
      usedPuzzleIds.add(p.id);
    }
  }

  // Remaining tutorials in array order
  for (const t of ALL_TUTORIALS) {
    if (!usedTutorialIds.has(t.id)) {
      levels.push({ kind: 'tutorial', data: t });
      usedTutorialIds.add(t.id);
      // Place power-raise after branching tutorial
      if (t.id === 'tut-branching') {
        const pr = getPuzzleById('rng-iterate');
        if (pr && !usedPuzzleIds.has(pr.id)) {
          levels.push({ kind: 'puzzle', data: pr });
          usedPuzzleIds.add(pr.id);
        }
      }
      // Place wave-comm puzzles right after intra-wave tutorial
      if (t.id === 'tut-intra-wave') {
        for (const pid of ['quad-average', 'wave-average']) {
          const p = getPuzzleById(pid);
          if (p && !usedPuzzleIds.has(p.id)) {
            levels.push({ kind: 'puzzle', data: p });
            usedPuzzleIds.add(p.id);
          }
        }
      }
    }
  }

  return levels;
}

const LEVEL_ORDER = buildLevelOrder();
import { validatePuzzle } from '../puzzle/validator';
import { WAVE_WIDTH } from '../isa/constants';
import { AssemblyResult, OperandType } from '../isa/types';
import { decodeBinary, disassemble } from '../isa/encoding';
import { lookupByOpcode } from '../isa/opcodes';
import { VERSION } from '../version';
import { TutorialPanel } from './tutorial-panel';

const STORAGE_KEY = 'humancompiler_completed';
const SOLUTIONS_KEY = 'humancompiler_solutions';
const TUTORIALS_KEY = 'humancompiler_tutorials_completed';
const DEBOUNCE_MS = 500;

export class App {
  private editor!: AsmEditor;
  private registers!: RegisterDisplay;
  private ioPanel!: IOPanel;
  private binaryView!: BinaryView;
  private instructionInfo!: InstructionInfo;
  private controls!: Controls;
  private puzzleSelect!: PuzzleSelect;
  private statusBar!: StatusBar;
  private leaderboard!: LeaderboardOverlay;
  private encyclopedia!: Encyclopedia;
  private tutorialPanel!: TutorialPanel;
  private errorListEl!: HTMLElement;

  private emulator = new Emulator();
  private currentPuzzle: Puzzle | null = null;
  private assemblyResult: AssemblyResult | null = null;

  // Puzzle execution state
  private currentInvocation = 0;
  private totalInvocations = 0;
  private collectedOutputs = new Map<number, number[]>();
  private totalCycles = 0; // accumulated across invocations

  // Run state
  private runTimer: ReturnType<typeof setInterval> | null = null;
  private speed = 5;

  // Debounce
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Revision tabs
  private revisionBar!: HTMLElement;
  private revisions: string[] = [];
  private activeRevision = 0;

  // Completed puzzle tracking
  private completedIds: Set<string>;

  // Tutorial mode
  private isTutorialMode = false;
  private currentTutorial: Tutorial | null = null;
  private completedTutorialIds: Set<string>;
  private ioContainer!: HTMLElement;

  constructor(root: HTMLElement) {
    this.completedIds = this.loadCompleted();
    this.completedTutorialIds = this.loadCompletedTutorials();
    this.buildLayout(root);
    this.wireEvents();
    // Show puzzle select on startup
    this.puzzleSelect.show(LEVEL_ORDER, this.allCompletedIds(), this.getBestScores());
  }

  private buildLayout(root: HTMLElement): void {
    // Header
    const header = document.createElement('div');
    header.className = 'header';

    const title = document.createElement('div');
    title.className = 'header__title';
    title.innerHTML = `<span class="icon">⚡</span> Human Compiler <span class="header__version">v${VERSION}</span>`;

    const puzzleBtn = document.createElement('button');
    puzzleBtn.className = 'header__puzzle-select';
    puzzleBtn.textContent = '📋 Puzzles';
    puzzleBtn.onclick = () => {
      this.puzzleSelect.show(LEVEL_ORDER, this.allCompletedIds(), this.getBestScores());
    };

    const spacer = document.createElement('div');
    spacer.className = 'header__spacer';

    const encyBtn = document.createElement('button');
    encyBtn.className = 'header__puzzle-select';
    encyBtn.textContent = '📖 ISA Reference';
    encyBtn.onclick = () => {
      this.encyclopedia.show();
    };

    const feedbackBtn = document.createElement('a');
    feedbackBtn.className = 'header__puzzle-select';
    feedbackBtn.textContent = '💬 Feedback?';
    feedbackBtn.href = 'https://github.com/ajmiles/TheHumanCompiler/issues';
    feedbackBtn.target = '_blank';
    feedbackBtn.style.textDecoration = 'none';

    const importBtn = document.createElement('button');
    importBtn.className = 'header__puzzle-select';
    importBtn.textContent = '📂 Import Binary';
    importBtn.title = 'Load a binary RDNA2 shader and disassemble it';
    importBtn.onclick = () => this.importBinary();

    const info = document.createElement('div');
    info.className = 'header__info';
    info.innerHTML = '<span class="header__badge">RDNA2</span>';

    header.append(title, puzzleBtn, spacer, encyBtn, importBtn, feedbackBtn, info);

    // Main 3-column layout
    const main = document.createElement('div');
    main.className = 'main-layout';

    // Left column: registers
    const leftPanel = document.createElement('div');
    leftPanel.className = 'panel';
    const regContainer = document.createElement('div');
    regContainer.style.flex = '1';
    regContainer.style.overflow = 'auto';
    leftPanel.appendChild(regContainer);

    // Center column: editor + binary
    const centerPanel = document.createElement('div');
    centerPanel.className = 'panel editor-panel';

    this.revisionBar = document.createElement('div');
    this.revisionBar.className = 'revision-bar';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'editor-container';

    const instrInfoContainer = document.createElement('div');
    instrInfoContainer.style.flexShrink = '0';

    const binaryContainer = document.createElement('div');
    binaryContainer.style.flexShrink = '0';

    this.errorListEl = document.createElement('div');
    this.errorListEl.className = 'error-list-panel';
    this.errorListEl.style.flexShrink = '0';

    centerPanel.append(this.revisionBar, editorContainer, instrInfoContainer, binaryContainer, this.errorListEl);

    // Right column: I/O panel + tutorial panel
    const rightPanel = document.createElement('div');
    rightPanel.className = 'panel';
    const ioContainer = document.createElement('div');
    ioContainer.style.flex = '1';
    ioContainer.style.overflow = 'auto';
    this.ioContainer = ioContainer;
    rightPanel.appendChild(ioContainer);

    // Drag handle between left panel and center
    const resizer = document.createElement('div');
    resizer.className = 'panel-resizer';

    main.append(leftPanel, resizer, centerPanel, rightPanel);

    // Drag logic
    this.setupResizer(resizer, leftPanel, main);

    // Controls bar
    const controlsBar = document.createElement('div');

    // Status bar sits inside controls bar
    const statusContainer = document.createElement('span');
    statusContainer.style.marginLeft = '16px';

    root.append(header, main, controlsBar);

    // Instantiate components
    this.editor = new AsmEditor(editorContainer);
    this.registers = new RegisterDisplay(regContainer);
    this.ioPanel = new IOPanel(ioContainer);
    this.tutorialPanel = new TutorialPanel(ioContainer);
    this.binaryView = new BinaryView(binaryContainer);
    this.instructionInfo = new InstructionInfo(instrInfoContainer);
    this.controls = new Controls(controlsBar);

    // Append status bar into controls bar area
    controlsBar.appendChild(statusContainer);
    this.statusBar = new StatusBar(statusContainer);

    // Puzzle select overlay (appended to root for full-screen overlay)
    const overlayHost = document.createElement('div');
    root.appendChild(overlayHost);
    this.puzzleSelect = new PuzzleSelect(overlayHost);

    // Leaderboard overlay
    const lbHost = document.createElement('div');
    root.appendChild(lbHost);
    this.leaderboard = new LeaderboardOverlay(lbHost);

    // Encyclopedia overlay
    const encyHost = document.createElement('div');
    root.appendChild(encyHost);
    this.encyclopedia = new Encyclopedia(encyHost);

    // Initial register display
    this.registers.update(this.emulator.state, 0);
  }

  private wireEvents(): void {
    // Auto-assemble on content change with debounce, and save solution
    this.editor.onContentChange(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.doAssemble();
        this.saveSolution();
      }, DEBOUNCE_MS);
    });

    // Update instruction info on cursor change (but not during drag selection)
    let mouseDown = false;
    document.addEventListener('mousedown', () => { mouseDown = true; });
    document.addEventListener('mouseup', () => {
      mouseDown = false;
      // Update on mouse up to catch the final position
      this.instructionInfo.update(this.assemblyResult, this.editor.getCursorLine());
    });
    this.editor.onCursorChange((line) => {
      if (!mouseDown) {
        this.instructionInfo.update(this.assemblyResult, line);
      }
    });

    // Controls
    this.controls.onStep(() => this.doStep());
    this.controls.onRun(() => this.doRun());
    this.controls.onStop(() => this.doStop());
    this.controls.onReset(() => this.doReset());
    this.controls.onSpeedChange((s) => {
      this.speed = s;
      // If running, restart interval with new speed
      if (this.runTimer) {
        this.doStop();
        this.doRun();
      }
    });

    // Puzzle / tutorial selection
    this.puzzleSelect.onSelect((id, kind) => {
      if (kind === 'tutorial') {
        this.loadTutorial(id);
      } else {
        this.loadPuzzle(id);
      }
    });

    // Tutorial step changes
    this.tutorialPanel.onStepChange((step) => {
      if (step.code) {
        this.editor.setSource(step.code);
        this.doAssemble();
        this.doReset();
      }
      this.registers.pulseSpecial(step.highlightSpecial);
    });
  }

  private setupResizer(resizer: HTMLElement, leftPanel: HTMLElement, main: HTMLElement): void {
    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(180, Math.min(startWidth + delta, main.clientWidth * 0.5));
      main.style.gridTemplateColumns = `${newWidth}px 4px 1fr 340px`;
      leftPanel.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resizer.classList.remove('panel-resizer--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = leftPanel.getBoundingClientRect().width;
      resizer.classList.add('panel-resizer--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── Assemble Pipeline ──

  private doAssemble(): void {
    const source = this.editor.getSource();
    this.assemblyResult = assemble(source);
    this.instructionInfo.setSource(source);

    this.editor.setErrors(
      this.assemblyResult.errors.map(e => ({
        line: e.line,
        column: e.column,
        message: e.message,
      })),
    );

    this.controls.setAssembleStatus(this.assemblyResult.errors.length);

    // Update error list
    this.renderErrorList(this.assemblyResult.errors);

    if (this.assemblyResult.errors.length === 0 && this.assemblyResult.binary.length > 0) {
      this.binaryView.update(this.assemblyResult.binary, this.emulator.state.pc);
    } else {
      this.binaryView.clear();
    }

    // Update instruction info panel with current cursor position
    this.instructionInfo.update(this.assemblyResult, this.editor.getCursorLine());

    // Update VGPR display range based on registers used
    this.registers.setUsedVGPRs(this.computeMaxVGPR());
    this.registers.setUsedSGPRs(this.computeMaxSGPR());

    // Reset execution state when code changes
    this.doReset();
  }

  /** Find the highest VGPR index referenced by the program and puzzle I/O. */
  private computeMaxVGPR(): number {
    let max = -1;

    // From puzzle I/O ports
    if (this.currentPuzzle) {
      for (const port of this.currentPuzzle.inputs) max = Math.max(max, port.register);
      for (const port of this.currentPuzzle.outputs) max = Math.max(max, port.register);
    }

    // From assembled instructions
    if (this.assemblyResult) {
      for (const instr of this.assemblyResult.instructions) {
        if (instr.dst.type === OperandType.VGPR) max = Math.max(max, instr.dst.value);
        if (instr.src0.type === OperandType.VGPR) max = Math.max(max, instr.src0.value);
        if (instr.src1?.type === OperandType.VGPR) max = Math.max(max, instr.src1.value);
      }
    }

    return max;
  }

  /** Find the highest SGPR index referenced by the program. */
  private computeMaxSGPR(): number {
    let max = -1;

    if (this.assemblyResult) {
      for (const instr of this.assemblyResult.instructions) {
        if (instr.dst.type === OperandType.SGPR) max = Math.max(max, instr.dst.value);
        if (instr.src0.type === OperandType.SGPR) max = Math.max(max, instr.src0.value);
        if (instr.src1?.type === OperandType.SGPR) max = Math.max(max, instr.src1.value);
      }
    }

    return max;
  }

  // ── Execution Controls ──

  // Whether the program has been primed (first step shows highlight without executing)
  private primed = false;

  private doStep(): void {
    if (!this.ensureLoaded()) return;

    // First step: just highlight the first instruction, don't execute
    if (!this.primed && !this.emulator.isComplete()) {
      this.primed = true;
      this.updateAllDisplays();
      return;
    }

    const stepped = this.emulator.step();
    this.afterStep();

    if (!stepped || this.emulator.isComplete()) {
      this.onProgramComplete();
    }
  }

  private doRun(): void {
    // Auto-reset if program already finished
    if (this.emulator.isComplete() && this.emulator.state.pc > 0) {
      this.doReset();
    }

    if (!this.ensureLoaded()) return;

    this.primed = true; // skip priming on Run
    this.controls.setRunning(true);
    this.statusBar.setStatus('Running...', 'info');

    this.runTimer = setInterval(() => {
      const stepped = this.emulator.step();
      this.afterStep();

      if (!stepped || this.emulator.isComplete()) {
        this.onProgramComplete();
        // If all invocations are done, onProgramComplete calls doStop.
        // If more invocations remain, the timer continues.
      }
    }, 1000 / this.speed);
  }

  private doStop(): void {
    if (this.runTimer) {
      clearInterval(this.runTimer);
      this.runTimer = null;
    }
    this.controls.setRunning(false);
    this.statusBar.setStatus('Stopped', 'info');
  }

  private doReset(): void {
    this.doStop();
    this.primed = false;
    this.currentInvocation = 0;
    this.totalCycles = 0;
    this.collectedOutputs.clear();

    // Always reload the binary from the current assembly result
    if (this.assemblyResult && this.assemblyResult.errors.length === 0 &&
        this.assemblyResult.binary.length > 0) {
      this.emulator.load(this.assemblyResult.binary);
    } else {
      this.emulator.reset();
    }

    if (this.currentPuzzle) {
      this.loadInputsForInvocation(this.currentPuzzle, this.currentInvocation);
    }

    this.updateAllDisplays();
    this.statusBar.clear();
    this.editor.clearHighlight();
  }

  private ensureLoaded(): boolean {
    // Re-assemble if needed
    if (!this.assemblyResult || this.assemblyResult.errors.length > 0) {
      this.doAssemble();
    }
    if (!this.assemblyResult || this.assemblyResult.errors.length > 0) {
      this.statusBar.setStatus('Fix assembly errors first', 'error');
      return false;
    }

    // Load binary if PC is at 0 and program might need reloading
    if (this.emulator.isComplete() && this.emulator.state.pc === 0) {
      this.emulator.load(this.assemblyResult.binary);
      // Restore puzzle inputs if active
      if (this.currentPuzzle) {
        this.loadInputsForInvocation(this.currentPuzzle, this.currentInvocation);
      }
    }

    return true;
  }

  private afterStep(): void {
    this.controls.updateCycle(this.emulator.getCycleCount());
    this.updateAllDisplays();
  }

  private updateAllDisplays(): void {
    this.registers.update(this.emulator.state, this.emulator.getPCBytes());

    if (this.assemblyResult && this.assemblyResult.binary.length > 0) {
      this.binaryView.update(this.assemblyResult.binary, this.emulator.state.pc);
    }

    // Highlight the current instruction's source line in the editor
    this.highlightCurrentLine();

    if (this.currentPuzzle) {
      this.ioPanel.updateOutput(this.collectedOutputs, this.currentInvocation);
    }
  }

  private highlightCurrentLine(): void {
    if (!this.assemblyResult) {
      this.editor.clearHighlight();
      return;
    }

    const pc = this.emulator.state.pc;
    const instrs = this.assemblyResult.instructions;

    if (pc < instrs.length) {
      this.editor.highlightLine(instrs[pc].line);
    } else {
      this.editor.clearHighlight();
    }
  }

  private renderErrorList(errors: { message: string; line: number; column: number }[]): void {
    if (errors.length === 0) {
      this.errorListEl.style.display = 'none';
      return;
    }

    this.errorListEl.style.display = '';
    this.errorListEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'panel__header error-list-header';
    header.textContent = `Errors (${errors.length})`;
    this.errorListEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'error-list-body';

    for (const err of errors) {
      const row = document.createElement('div');
      row.className = 'error-list-item';
      row.ondblclick = () => {
        this.editor.highlightLine(err.line);
        this.editor.revealLine(err.line);
      };

      const loc = document.createElement('span');
      loc.className = 'error-list-loc';
      loc.textContent = `Ln ${err.line}`;

      const msg = document.createElement('span');
      msg.className = 'error-list-msg';
      msg.textContent = err.message;

      row.append(loc, msg);
      list.appendChild(row);
    }

    this.errorListEl.appendChild(list);
  }

  // ── Puzzle Engine ──

  private loadPuzzle(id: string): void {
    const puzzle = getPuzzleById(id);
    if (!puzzle) return;

    // Exit tutorial mode if active
    this.exitTutorialMode();

    this.doStop();
    this.primed = false;
    this.currentPuzzle = puzzle;
    this.currentInvocation = 0;
    this.collectedOutputs.clear();

    // Calculate total invocations
    const streamLen = puzzle.outputs[0]?.values.length ?? 0;
    this.totalInvocations = Math.ceil(streamLen / WAVE_WIDTH);

    // Set up I/O panel
    this.ioPanel.setPuzzle(puzzle);

    // Set up emulator with placeholder program
    this.emulator.reset();

    // Restore saved revisions or create initial one with starter template
    const saved = this.loadSolution(puzzle.id);
    if (saved) {
      this.revisions = saved.revisions;
      this.activeRevision = saved.activeIndex;
    } else {
      const inputNames = puzzle.inputs.map(i => `; ${i.name} in v${i.register}`).join('\n');
      const outputNames = puzzle.outputs.map(o => `; ${o.name} to v${o.register}`).join('\n');
      const template = `; ${puzzle.title}\n${inputNames}\n${outputNames}\n; Write your solution below:\n\ns_endpgm\n`;
      this.revisions = [template];
      this.activeRevision = 0;
    }
    this.editor.setSource(this.revisions[this.activeRevision]);
    this.renderRevisionTabs();

    // Try to assemble and load
    this.doAssemble();
    this.setupInvocation(puzzle, 0);

    this.statusBar.setStatus(`Puzzle: ${puzzle.title}`, 'info');
  }

  private setupInvocation(puzzle: Puzzle, invocationIndex: number): void {
    this.currentInvocation = invocationIndex;

    // Reset emulator state but try to keep program loaded
    if (this.assemblyResult && this.assemblyResult.errors.length === 0 &&
        this.assemblyResult.binary.length > 0) {
      this.emulator.load(this.assemblyResult.binary);
    } else {
      this.emulator.reset();
    }

    this.loadInputsForInvocation(puzzle, invocationIndex);
    this.controls.updateCycle(this.emulator.getCycleCount());
    this.updateAllDisplays();
  }

  private loadInputsForInvocation(puzzle: Puzzle, invocationIndex: number): void {
    const start = invocationIndex * WAVE_WIDTH;

    for (const input of puzzle.inputs) {
      if (input.isSGPR) {
        // Scalar input: one value per invocation (use first value in the invocation's range)
        const value = start < input.values.length ? input.values[start] : 0;
        this.emulator.state.writeSGPR(input.register, value >>> 0);
        continue;
      }
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        const idx = start + lane;
        const value = idx < input.values.length ? input.values[idx] : 0;
        if (input.isInteger) {
          this.emulator.state.writeVGPR_u32(input.register, lane, value >>> 0);
        } else {
          this.emulator.state.writeVGPR(input.register, lane, value);
        }
      }
    }

    // Clear modified regs since we're loading inputs, not executing
    this.emulator.state.modifiedRegs.clear();
  }

  private onProgramComplete(): void {
    if (!this.currentPuzzle) {
      this.doStop();
      this.statusBar.setStatus('Program complete', 'info');
      return;
    }

    // Accumulate cycles from this invocation
    this.totalCycles += this.emulator.getCycleCount();

    // Collect outputs from designated VGPRs
    for (const output of this.currentPuzzle.outputs) {
      if (!this.collectedOutputs.has(output.register)) {
        this.collectedOutputs.set(output.register, []);
      }
      const collected = this.collectedOutputs.get(output.register)!;

      const start = this.currentInvocation * WAVE_WIDTH;
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        const idx = start + lane;
        if (idx < output.values.length) {
          collected[idx] = output.isInteger
            ? this.emulator.state.readVGPR_u32(output.register, lane)
            : this.emulator.state.readVGPR(output.register, lane);
        }
      }
    }

    this.ioPanel.updateOutput(this.collectedOutputs, this.currentInvocation);

    // Check if more invocations remain
    if (this.currentInvocation + 1 < this.totalInvocations) {
      this.currentInvocation++;
      this.setupInvocation(this.currentPuzzle, this.currentInvocation);

      // If we were running, continue automatically
      if (this.runTimer === null) {
        this.statusBar.setStatus(
          `Invocation ${this.currentInvocation + 1} / ${this.totalInvocations}`,
          'info',
        );
      }
    } else {
      // All invocations done — validate
      this.doStop();
      const result = validatePuzzle(this.currentPuzzle, this.collectedOutputs);
      this.ioPanel.showResult(result);

      if (result.pass) {
        this.completedIds.add(this.currentPuzzle.id);
        this.saveCompleted();
        this.statusBar.setStatus(
          `✓ PASSED — ${result.totalCorrect}/${result.totalExpected} correct`,
          'success',
        );

        // Compute solution stats and show leaderboard
        const stats: SolutionStats = {
          codeSize: this.assemblyResult ? this.assemblyResult.binary.length * 4 : 0,
          vgprsUsed: this.computeMaxVGPR() + 1,
          cycles: this.totalCycles,
        };
        this.leaderboard.show(this.currentPuzzle.id, this.currentPuzzle.title, stats);
      } else {
        this.statusBar.setStatus(
          `✗ FAILED — ${result.totalCorrect}/${result.totalExpected} correct`,
          'error',
        );
      }
    }
  }

  // ── Tutorial Engine ──

  private loadTutorial(id: string): void {
    const tutorial = getTutorialById(id);
    if (!tutorial) return;

    this.doStop();
    this.primed = false;
    this.currentPuzzle = null;
    this.currentTutorial = tutorial;
    this.isTutorialMode = true;

    // Hide I/O panel, show tutorial panel
    // Hide all children of ioContainer except the tutorial panel
    for (const child of Array.from(this.ioContainer.children)) {
      if ((child as HTMLElement).classList?.contains('tutorial-panel')) {
        (child as HTMLElement).style.display = '';
      } else {
        (child as HTMLElement).style.display = 'none';
      }
    }
    this.tutorialPanel.setTutorial(tutorial);

    // Load code from the first step if it has one
    const firstStep = tutorial.steps[0];
    if (firstStep.code) {
      this.editor.setSource(firstStep.code);
    } else {
      this.editor.setSource('; Tutorial mode\ns_endpgm\n');
    }
    this.doAssemble();
    this.emulator.reset();
    this.updateAllDisplays();

    // Collapse instruction info and binary view to keep focus on the editor
    this.instructionInfo.setCollapsed(true);
    this.binaryView.setCollapsed(true);

    this.statusBar.setStatus(`Tutorial: ${tutorial.title}`, 'info');
  }

  private exitTutorialMode(): void {
    if (!this.isTutorialMode) return;

    // Mark tutorial as completed when exiting
    if (this.currentTutorial) {
      this.completedTutorialIds.add(this.currentTutorial.id);
      this.saveCompletedTutorials();
    }

    this.isTutorialMode = false;
    this.currentTutorial = null;
    this.tutorialPanel.hide();
    this.registers.pulseSpecial(undefined);

    // Re-show I/O panel content, hide tutorial panel
    for (const child of Array.from(this.ioContainer.children)) {
      if ((child as HTMLElement).classList?.contains('tutorial-panel')) {
        (child as HTMLElement).style.display = 'none';
      } else {
        (child as HTMLElement).style.display = '';
      }
    }
  }

  private allCompletedIds(): Set<string> {
    return new Set([...this.completedIds, ...this.completedTutorialIds]);
  }

  private getBestScores(): Map<string, BestScore> {
    const scores = new Map<string, BestScore>();
    for (const puzzle of ALL_PUZZLES) {
      const entries = getLeaderboard(puzzle.id);
      if (entries.length === 0) continue;
      // Find best in each category
      let bestSize = Infinity, bestVgprs = Infinity, bestCycles = Infinity;
      for (const e of entries) {
        if (e.codeSize < bestSize) bestSize = e.codeSize;
        if (e.vgprsUsed < bestVgprs) bestVgprs = e.vgprsUsed;
        if (e.cycles < bestCycles) bestCycles = e.cycles;
      }
      scores.set(puzzle.id, { codeSize: bestSize, vgprsUsed: bestVgprs, cycles: bestCycles });
    }
    return scores;
  }

  // ── Persistence ──

  private loadCompleted(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  private saveCompleted(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.completedIds]));
  }

  private loadCompletedTutorials(): Set<string> {
    try {
      const raw = localStorage.getItem(TUTORIALS_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  private saveCompletedTutorials(): void {
    localStorage.setItem(TUTORIALS_KEY, JSON.stringify([...this.completedTutorialIds]));
  }

  private saveSolution(): void {
    if (!this.currentPuzzle) return;
    // Update current revision content
    this.revisions[this.activeRevision] = this.editor.getSource();
    try {
      const all = JSON.parse(localStorage.getItem(SOLUTIONS_KEY) ?? '{}');
      all[this.currentPuzzle.id] = {
        revisions: this.revisions,
        activeIndex: this.activeRevision,
      };
      localStorage.setItem(SOLUTIONS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  private loadSolution(puzzleId: string): { revisions: string[]; activeIndex: number } | null {
    try {
      const all = JSON.parse(localStorage.getItem(SOLUTIONS_KEY) ?? '{}');
      const entry = all[puzzleId];
      if (!entry) return null;
      // Handle legacy format (plain string)
      if (typeof entry === 'string') {
        return { revisions: [entry], activeIndex: 0 };
      }
      if (entry.revisions && entry.revisions.length > 0) {
        return entry;
      }
      return null;
    } catch {
      return null;
    }
  }

  private renderRevisionTabs(): void {
    this.revisionBar.innerHTML = '';

    for (let i = 0; i < this.revisions.length; i++) {
      const tab = document.createElement('button');
      tab.className = 'revision-tab' + (i === this.activeRevision ? ' revision-tab--active' : '');
      tab.title = `Revision ${i + 1}`;
      const idx = i;
      tab.onclick = () => this.switchRevision(idx);

      const label = document.createElement('span');
      label.textContent = `Rev ${i + 1}`;
      tab.appendChild(label);

      // Close button (only if more than 1 revision)
      if (this.revisions.length > 1) {
        const closeBtn = document.createElement('span');
        closeBtn.className = 'revision-tab__close';
        closeBtn.textContent = '×';
        closeBtn.title = `Close Rev ${i + 1}`;
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          this.closeRevision(idx);
        };
        tab.appendChild(closeBtn);
      }

      this.revisionBar.appendChild(tab);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'revision-tab revision-tab--add';
    addBtn.textContent = '+';
    addBtn.title = 'New revision (copies current code)';
    addBtn.onclick = () => this.addRevision();
    this.revisionBar.appendChild(addBtn);
  }

  private switchRevision(index: number): void {
    if (index === this.activeRevision) return;
    // Save current content to current revision
    this.revisions[this.activeRevision] = this.editor.getSource();
    this.activeRevision = index;
    this.editor.setSource(this.revisions[index] ?? '');
    this.renderRevisionTabs();
    this.doAssemble();
    this.saveSolution();
  }

  private addRevision(): void {
    // Save current first
    this.revisions[this.activeRevision] = this.editor.getSource();
    // New revision starts with a fresh template
    let template = '; Write your solution below:\n\ns_endpgm\n';
    if (this.currentPuzzle) {
      const inputNames = this.currentPuzzle.inputs.map(i => `; ${i.name} in v${i.register}`).join('\n');
      const outputNames = this.currentPuzzle.outputs.map(o => `; ${o.name} to v${o.register}`).join('\n');
      template = `; ${this.currentPuzzle.title}\n${inputNames}\n${outputNames}\n; Write your solution below:\n\ns_endpgm\n`;
    }
    this.revisions.push(template);
    this.activeRevision = this.revisions.length - 1;
    this.editor.setSource(template);
    this.renderRevisionTabs();
    this.saveSolution();
  }

  private closeRevision(index: number): void {
    if (this.revisions.length <= 1) return;
    this.revisions.splice(index, 1);
    // Adjust active index
    if (this.activeRevision >= this.revisions.length) {
      this.activeRevision = this.revisions.length - 1;
    } else if (this.activeRevision > index) {
      this.activeRevision--;
    } else if (this.activeRevision === index) {
      this.activeRevision = Math.min(index, this.revisions.length - 1);
    }
    this.editor.setSource(this.revisions[this.activeRevision] ?? '');
    this.renderRevisionTabs();
    this.doAssemble();
    this.saveSolution();
  }

  // ── Binary Import ──

  private importBinary(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bin,.o,.so,.elf,*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(buffer);

        // Pad to 4-byte alignment
        const wordCount = Math.ceil(bytes.length / 4);
        const padded = new Uint8Array(wordCount * 4);
        padded.set(bytes);
        const binary = new Uint32Array(padded.buffer);

        try {
          const decoded = decodeBinary(binary);
          const lines: string[] = [];
          lines.push(`; Disassembled from: ${file.name}`);
          lines.push(`; Size: ${bytes.length} bytes (${binary.length} dwords)`);
          lines.push('');

          for (const instr of decoded) {
            try {
              const asm = disassemble(instr, lookupByOpcode);
              lines.push(asm);
            } catch {
              const addr = (instr.address * 4).toString(16).padStart(6, '0');
              lines.push(`; ${addr}: <decode error> format=${instr.format} opcode=0x${instr.opcode.toString(16)}`);
            }
          }

          lines.push('');
          this.editor.setSource(lines.join('\n'));
          // Don't assemble — imported disassembly may contain instructions
          // the assembler doesn't support yet
          this.statusBar.setStatus(`Imported ${file.name}: ${decoded.length} instructions`, 'success');
        } catch (e) {
          this.statusBar.setStatus(`Import failed: ${(e as Error).message}`, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }
}
