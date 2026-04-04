// ── Tutorial Definitions ──

export interface TutorialStep {
  title: string;
  text: string;        // Rendered as HTML paragraphs
  code?: string;       // Pre-filled code for this step (sets editor content)
  highlight?: number;  // Line to highlight in the editor
  highlightSpecial?: string;  // Name of a special register to pulse (e.g. 'SCC', 'EXEC')
}

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  steps: TutorialStep[];
}

// ── Tutorial 01: Welcome to the GPU ──

const WELCOME_TO_GPU: Tutorial = {
  id: 'tut-welcome',
  title: 'Welcome to the GPU',
  description: 'Learn the basics of AMD GPU assembly — registers, lanes, and your first instructions.',
  steps: [
    {
      title: 'What is a GPU shader?',
      text:
        'Welcome to Human Compiler! In this game, you\'ll write real AMD GPU assembly code (ISA) to solve puzzles.\n\n' +
        'A GPU doesn\'t run code one instruction at a time like a CPU. Instead, it runs the SAME program on hundreds of data elements simultaneously. This is called <strong>SIMD</strong> — Single Instruction, Multiple Data.\n\n' +
        'On AMD\'s RDNA2 architecture, 32 threads (called <em>lanes</em>) execute in lockstep as a <em>wavefront</em> (or <em>wave</em>). Every instruction you write executes on all 32 lanes at once.',
    },
    {
      title: 'Registers',
      text:
        'Each lane has its own set of <strong>Vector General Purpose Registers (VGPRs)</strong>. When you write to <code>v0</code>, you\'re actually writing 32 different values — one per lane.\n\n' +
        'There are also <strong>Scalar General Purpose Registers (SGPRs)</strong> that are shared across all lanes. These hold values that are the same for every thread, like constants or buffer addresses.\n\n' +
        'Look at the register panel on the left. Each row is a VGPR, and each column (L0, L1, …, L31) is a lane.',
    },
    {
      title: 'Your first instruction',
      text:
        'Let\'s write your first instruction. The code below is already loaded in the editor:\n\n' +
        '<code>v_mov_b32 v1, 1.0</code>\n\n' +
        'This moves the float value 1.0 into <code>v1</code> for every active lane. Press <strong>Step</strong> to execute it and watch the register panel update.\n\n' +
        '<em>Note: v_mov_b32 copies raw 32-bit data. Using <code>1.0</code> (an inline float constant) stores the IEEE 754 bit pattern for 1.0.</em>',
      code: 'v_mov_b32 v1, 1.0\ns_endpgm',
    },
    {
      title: 'Adding two registers',
      text:
        'Now let\'s add two registers together:\n\n' +
        '<code>v_mov_b32 v0, 4.0</code> — load 4.0 into v0\n' +
        '<code>v_mov_b32 v1, 2.0</code> — load 2.0 into v1\n' +
        '<code>v_add_f32 v2, v0, v1</code> — add them as floats, store in v2\n\n' +
        'Step through each instruction and watch <code>v0</code>, <code>v1</code>, then <code>v2</code> fill in. You should see 6.0 in v2!',
      code: 'v_mov_b32 v0, 4.0\nv_mov_b32 v1, 2.0\nv_add_f32 v2, v0, v1\ns_endpgm',
    },
    {
      title: 'Every lane gets the same code',
      text:
        'Notice how all 32 lanes show the same values? That\'s because we loaded the same constant into every lane.\n\n' +
        'In real shaders, each lane typically starts with different input data. In the puzzles, the input VGPRs are pre-loaded with different values per lane from the input stream.\n\n' +
        'Each wavefront processes 32 elements at once. A stream of 64 values needs 2 wavefront invocations.',
    },
    {
      title: 'Instruction types',
      text:
        'AMD RDNA2 has several types of instructions, color-coded in the editor:\n\n' +
        '🟢 <strong>VALU</strong> (Vector ALU) — Math operations that run per-lane: <code>v_add_f32</code>, <code>v_mul_f32</code>, <code>v_fma_f32</code>\n\n' +
        '🔵 <strong>SALU</strong> (Scalar ALU) — Operations that run once for the whole wave: <code>s_mov_b32</code>, <code>s_add_i32</code>\n\n' +
        '🟡 <strong>SOPP</strong> (Program control) — Branches, barriers, waits: <code>s_endpgm</code>, <code>s_waitcnt</code>\n\n' +
        '🟠 <strong>VMEM</strong> (Vector memory) — Per-lane memory access: <code>buffer_load_dword</code>\n\n' +
        '🔵 <strong>SMEM</strong> (Scalar memory) — Shared memory loads: <code>s_load_dwordx4</code>\n\n' +
        '🔴 <strong>DS</strong> (Local data share) — Shared memory between lanes: <code>ds_read_b32</code>',
    },
    {
      title: 'Ready to go!',
      text:
        'You now know the fundamentals:\n\n' +
        '• A wavefront runs 32 lanes in lockstep\n' +
        '• VGPRs are per-lane, SGPRs are shared\n' +
        '• Instructions operate on all lanes simultaneously\n\n' +
        'Close this tutorial and start with the first puzzle — <strong>Signal Boost</strong>. Just multiply each input value by 2!\n\n' +
        'Hint: <code>v_mul_f32 v1, v0, 2.0</code> — one instruction is all you need.',
    },
  ],
};

// ── Tutorial 03: Branching ──

const BRANCHING: Tutorial = {
  id: 'tut-branching',
  title: 'Branching',
  description: 'Learn how GPUs handle conditional execution, the EXEC mask, and divergent control flow.',
  steps: [
    {
      title: 'Branching on a GPU',
      text:
        'On a CPU, an <code>if/else</code> simply jumps to one path or the other. On a GPU, it\'s more complicated — 32 lanes execute in lockstep. What happens when some lanes want to take the <code>if</code> and others want the <code>else</code>?\n\n' +
        'The answer involves two mechanisms:\n' +
        '• <strong>Scalar branches</strong> — the whole wavefront jumps (or doesn\'t). Used when the condition is the same for all lanes.\n' +
        '• <strong>The EXEC mask</strong> — individual lanes are disabled while the rest keep running. Used when lanes disagree.',
    },
    {
      title: 'The Scalar Condition Code (SCC)',
      text:
        'Scalar ALU instructions can set a 1-bit flag called <strong>SCC</strong> (Scalar Condition Code). The <code>s_cmp_*</code> family compares two scalar values and writes the result to SCC.\n\n' +
        'Try stepping through this code. After <code>s_cmp_eq_u32 s0, 5</code>, SCC becomes <strong>1</strong> (true — s0 equals 5). After <code>s_cmp_eq_u32 s0, 3</code>, SCC becomes <strong>0</strong> (false — s0 is not 3).\n\n' +
        'Watch the <strong>SCC</strong> value in the scalar register panel as you step.',
      code: '; Load 5 into scalar register s0\ns_mov_b32 s0, 5\n; Compare s0 == 5 → SCC = 1 (true)\ns_cmp_eq_u32 s0, 5\n; Compare s0 == 3 → SCC = 0 (false)\ns_cmp_eq_u32 s0, 3\ns_endpgm',
      highlightSpecial: 'SCC',
    },
    {
      title: 'Conditional Scalar Branches',
      text:
        'Once SCC is set, you can conditionally jump with <code>s_cbranch_scc0</code> (jump if SCC=0) or <code>s_cbranch_scc1</code> (jump if SCC=1). The branch target is a PC-relative offset encoded in the instruction.\n\n' +
        'A typical pattern looks like:\n\n' +
        '<code>s_cmp_gt_u32 s0, 10</code> — is s0 > 10?\n' +
        '<code>s_cbranch_scc0 skip</code> — if not, skip ahead\n' +
        '<code>v_mul_f32 v0, v0, 2.0</code> — only runs if s0 > 10\n' +
        '<code>skip:</code>\n\n' +
        'Since the condition is <em>scalar</em> (same for all lanes), the entire wavefront either takes the branch or doesn\'t. No lanes are left behind.\n\n' +
        '<em>Note: The assembler doesn\'t support labels yet, so branch offsets must be computed manually. This tutorial focuses on the concepts.</em>',
    },
    {
      title: 'The EXEC Mask',
      text:
        'The <strong>EXEC</strong> register is a 32-bit mask where each bit controls whether the corresponding lane is <em>active</em>. When a bit is 0, that lane\'s vector instructions still execute but their results are <strong>discarded</strong> — no register writes occur.\n\n' +
        'Step through this code. After <code>v_mov_b32 v0, 1.0</code>, all 32 lanes have 1.0. Then we set EXEC to <code>0x0000FFFF</code> — only the lower 16 lanes (L0–L15) are active. The final <code>v_mov_b32 v1, 2.0</code> only writes to those 16 lanes.\n\n' +
        'Check the VGPR panel: <strong>v1</strong> should be 2.0 for L0–L15 and 0.0 for L16–L31.',
      code: '; All 32 lanes write v0\nv_mov_b32 v0, 1.0\n; Disable upper 16 lanes\ns_mov_b32 exec_lo, 0x0000FFFF\n; Only lower 16 lanes write v1\nv_mov_b32 v1, 2.0\ns_endpgm',
      highlightSpecial: 'EXEC',
    },
    {
      title: 'Vector Comparison',
      text:
        'Scalar comparisons test one value against another. <strong>Vector comparisons</strong> test each lane independently, producing a bitmask result.\n\n' +
        '<code>v_cmp_gt_f32</code> compares per-lane and writes the result to <strong>VCC</strong> (Vector Condition Code) — a 32-bit mask where bit N = 1 if lane N\'s comparison was true.\n\n' +
        '<code>v_cmpx_gt_f32</code> does the same but writes directly to <strong>EXEC</strong>, immediately masking off lanes that fail the test.\n\n' +
        'Try this example: every lane has 1.0 in v0. <code>v_cmpx_gt_f32</code> tests if 1.0 > 2.0 — it\'s false for <em>all</em> lanes, so EXEC becomes 0. The next instruction has no effect because no lanes are active.',
      code: '; All lanes: v0 = 1.0\nv_mov_b32 v0, 1.0\n; Test v0 > 2.0 → false for all lanes → EXEC = 0\nv_cmpx_gt_f32 v0, 2.0\n; No lanes active — v1 stays at 0\nv_mov_b32 v1, 99.0\ns_endpgm',
      highlightSpecial: 'EXEC',
    },
    {
      title: 'The Divergent If/Else Pattern',
      text:
        'Let\'s see the save-and-mask pattern in action. In this example, lanes 0–15 have <code>v0=0.5</code> and lanes 16–31 have <code>v0=4.0</code>.\n\n' +
        'We compare <code>v0 > 1.0</code> — lanes 16–31 pass (VCC bits 16–31 set). Then <code>s_and_saveexec_b64 s0, vcc</code> saves the old EXEC to s0 and masks EXEC to only the "true" lanes.\n\n' +
        'Now <code>v_mul_f32 v1, v0, 2.0</code> only runs on lanes 16–31 (the "if" body). We restore EXEC from s0 and all lanes are active again. Step through and watch <strong>VCC</strong> and <strong>EXEC</strong> change!\n\n' +
        '<em>v1 ends up as 8.0 for lanes 16–31 and 0.0 for lanes 0–15 — only the lanes that passed the comparison were modified.</em>',
      code: '; Setup: lanes 0-15 get 0.5, lanes 16-31 get 4.0\nv_mov_b32 v0, 0.5\ns_mov_b32 exec_lo, 0xFFFF0000\nv_mov_b32 v0, 4.0\ns_mov_b32 exec_lo, 0xFFFFFFFF\n;\n; Compare v0 > 1.0 → VCC has bits set for lanes 16-31\nv_cmp_gt_f32 v0, 1.0\n;\n; Save EXEC to s0, then EXEC &= VCC (only "true" lanes)\ns_and_saveexec_b64 s0, vcc\n;\n; "If" body — only lanes 16-31 run this\nv_mul_f32 v1, v0, 2.0\n;\n; Restore EXEC — all lanes active again\ns_mov_b32 exec_lo, s0\ns_endpgm',
      highlightSpecial: 'EXEC',
    },
    {
      title: 'Key takeaways',
      text:
        'GPU branching in summary:\n\n' +
        '• <strong>Scalar branches</strong> (<code>s_cbranch_*</code>) jump the entire wavefront. Used for uniform conditions (loop counters, constants).\n\n' +
        '• <strong>EXEC masking</strong> handles per-lane divergence. Lanes are disabled, not skipped — the instruction still executes, but masked lanes don\'t write results.\n\n' +
        '• <strong>Divergent code costs both paths</strong>. If half the lanes take the "if" and half take the "else", the GPU runs both blocks sequentially. This is why GPU code avoids divergent branches when possible.\n\n' +
        '• <code>v_cmpx_*</code> is a shortcut that writes directly to EXEC, combining comparison and masking in one instruction.',
    },
  ],
};

// ── Tutorial 04: Intra-wave Communication ──

const INTRA_WAVE: Tutorial = {
  id: 'tut-intra-wave',
  title: 'Intra-wave Communication',
  description: 'Share data between lanes using readlane, ds_swizzle, and DPP instructions.',
  steps: [
    {
      title: 'Communication Between Lanes',
      text:
        'Normally, each lane works on its own data in isolation. But many algorithms need lanes to <strong>share</strong> data with each other — reductions (sum all values), prefix sums, sorting, and broadcasting a value to all lanes.\n\n' +
        'AMD RDNA2 provides several mechanisms for intra-wave communication, from simple scalar broadcasts to powerful lane permutation instructions. These operations happen <em>within a single wavefront</em> — no memory access required.',
    },
    {
      title: 'v_readfirstlane_b32 — Broadcast to Scalar',
      text:
        'The simplest form of lane communication: <code>v_readfirstlane_b32</code> reads the value from <strong>lane 0</strong> (the first active lane) of a VGPR and writes it to a <strong>scalar register</strong>.\n\n' +
        'This is used when you need a per-lane value promoted to a scalar — for example, to use as a branch condition or a memory address that must be uniform.\n\n' +
        'Step through the code below. We first load different values into the upper and lower halves using EXEC masking, then <code>v_readfirstlane_b32</code> reads lane 0\'s value (1.0) into s0.',
      code: '; Load 1.0 into all lanes\nv_mov_b32 v0, 1.0\n; Mask: only upper 16 lanes\ns_mov_b32 exec_lo, 0xFFFF0000\n; Upper lanes get 2.0\nv_mov_b32 v0, 2.0\n; Restore all lanes\ns_mov_b32 exec_lo, 0xFFFFFFFF\n; Read lane 0 (value=1.0) into s0\nv_readfirstlane_b32 s0, v0\ns_endpgm',
    },
    {
      title: 'v_readlane_b32 — Read a Specific Lane',
      text:
        'While <code>v_readfirstlane_b32</code> always reads the first active lane, <code>v_readlane_b32</code> lets you read from <strong>any lane by index</strong>.\n\n' +
        'In this example, lanes 0–15 hold 1.0 and lanes 16–31 hold 4.0. We use <code>v_readlane_b32</code> to read lane 0 into s0 (gets 1.0) and lane 16 into s1 (gets 4.0). The lane index comes from a scalar register or inline constant.\n\n' +
        'Step through and check s0 and s1 in the SGPRs panel (switch to F32 mode to see the float values).\n\n' +
        '<em>In HLSL, this maps to <code>WaveReadLaneAt(value, laneIndex)</code>.</em>',
      code: '; Setup: lanes 0-15 = 1.0, lanes 16-31 = 4.0\nv_mov_b32 v0, 1.0\ns_mov_b32 exec_lo, 0xFFFF0000\nv_mov_b32 v0, 4.0\ns_mov_b32 exec_lo, 0xFFFFFFFF\n;\n; Read lane 0 → s0 (should be 1.0)\nv_readlane_b32 s0, v0, 0\n; Read lane 16 → s1 (should be 4.0)\nv_readlane_b32 s1, v0, 16\ns_endpgm',
    },
    {
      title: 'ds_swizzle_b32 — Lane Permutation',
      text:
        '<code>ds_swizzle_b32</code> permutes data between lanes <strong>without touching LDS memory</strong>, despite the "ds" prefix. It\'s a pure register-to-register lane shuffle.\n\n' +
        'The permutation is controlled by a 16-bit <em>offset</em> word. When bit 15 is clear, it uses <strong>bitwise mode</strong> for full 32-thread data sharing:\n\n' +
        '<code style="font-family:monospace;letter-spacing:1px">┌──────────┬──────────┬──────────┬───┐\n' +
        '│  bit 15  │ [14:10]  │  [9:5]   │[4:0]│\n' +
        '│  mode=0  │ xor_mask │ or_mask  │and_mask│\n' +
        '└──────────┴──────────┴──────────┴───┘</code>\n\n' +
        'The source lane is computed as: <code>src = ((lane & and_mask) | or_mask) ^ xor_mask</code>\n\n' +
        'When bit 15 is set, it uses <strong>QDM (Quad Distribute Mode)</strong> — each group of 4 lanes gets independent 2-bit selectors to pick a source lane within its quad.\n\n' +
        'Try this example. First, even lanes get 0.0 and odd lanes get 1.0. Then:\n' +
        '• <strong>XOR swap</strong> (<code>0x041F</code>): xor=1, and=0x1F → swaps adjacent pairs (0↔1, 2↔3, …) so v1 has the values flipped\n' +
        '• <strong>OR broadcast odd</strong> (<code>0x003E</code>): or=1, and=0x1E → every lane reads its odd neighbour, so v2 is all 1.0',
      code: '; Setup: even lanes=0.0, odd lanes=1.0\nv_mov_b32 v0, 0.0\ns_mov_b32 exec_lo, 0xAAAAAAAA\nv_mov_b32 v0, 1.0\ns_mov_b32 exec_lo, 0xFFFFFFFF\n;\n; XOR swap: xor=1, or=0, and=0x1F → 0x041F\n; Lane 0 reads lane 1, lane 1 reads lane 0, etc.\n; v1: odd lanes get 0.0, even lanes get 1.0 (swapped!)\nds_swizzle_b32 v1, v0 offset:0x041F\n;\n; OR broadcast odd: xor=0, or=1, and=0x1E → 0x003E\n; src = (lane & 0x1E) | 1 → every lane reads its odd neighbour\n; v2: all lanes get 1.0 (the odd lane value)\nds_swizzle_b32 v2, v0 offset:0x003E\ns_endpgm',
    },
    {
      title: 'DPP — Data Parallel Primitives',
      text:
        '<strong>DPP</strong> (Data Parallel Primitives) is not a separate instruction — it\'s a <em>modifier</em> on existing VALU instructions. It lets you read a source operand from a <strong>neighbouring lane</strong> instead of the current lane.\n\n' +
        'DPP operations include:\n' +
        '• <strong>Row shift</strong> — shift data left/right by 1–15 lanes within a row of 16\n' +
        '• <strong>Row rotate</strong> — circular shift within a row\n' +
        '• <strong>Row broadcast</strong> — copy one lane\'s value to all lanes in the row\n' +
        '• <strong>quad_perm</strong> — arbitrary 4-lane permutation within each group of 4 lanes\n' +
        '• <strong>Wave shift/rotate</strong> — shift across the full 32-lane wavefront\n\n' +
        'DPP is the workhorse behind <code>WavePrefixSum</code>, <code>WaveActiveSum</code>, and other subgroup operations in HLSL/GLSL.',
    },
    {
      title: 'Building a Parallel Reduction',
      text:
        'A classic use of lane communication: summing all 32 lanes\' values into a single result. Using DPP row-shifts, a full reduction takes just 5 steps:\n\n' +
        '<code>Step 1:</code> Add each lane with its neighbour 1 apart (DPP row_shr:1) → 16 partial sums\n' +
        '<code>Step 2:</code> Add with neighbour 2 apart (DPP row_shr:2) → 8 partial sums\n' +
        '<code>Step 3:</code> Add with neighbour 4 apart (DPP row_shr:4) → 4 partial sums\n' +
        '<code>Step 4:</code> Add with neighbour 8 apart (DPP row_shr:8) → 2 partial sums\n' +
        '<code>Step 5:</code> Add the two halves (DPP row_shr:16 or ds_swizzle) → 1 final sum\n\n' +
        'Each step halves the number of active partial sums. After 5 iterations, lane 0 holds the sum of all 32 values — computed in 5 cycles with no memory access.\n\n' +
        'This log₂(N) reduction pattern is fundamental to GPU parallel programming.',
    },
    {
      title: 'Key takeaways',
      text:
        'Intra-wave communication in summary:\n\n' +
        '• <code>v_readfirstlane_b32</code> broadcasts lane 0\'s value to a scalar register — the simplest lane→scalar bridge.\n\n' +
        '• <code>v_readlane_b32</code> reads any lane by index — useful for targeted data extraction.\n\n' +
        '• <code>ds_swizzle_b32</code> permutes data between lanes using a control word — flexible and fast, despite the "ds" name.\n\n' +
        '• <strong>DPP</strong> modifiers on VALU instructions enable neighbouring-lane access for reductions, scans, and shuffles.\n\n' +
        'These primitives map to HLSL\'s <code>Wave*</code> intrinsics and are essential for high-performance GPU programming.',
    },
  ],
};

// ── All Tutorials ──

export const ALL_TUTORIALS: Tutorial[] = [
  WELCOME_TO_GPU,
  BRANCHING,
  INTRA_WAVE,
];

export function getTutorialById(id: string): Tutorial | undefined {
  return ALL_TUTORIALS.find(t => t.id === id);
}
