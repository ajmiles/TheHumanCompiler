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

// ── Tutorial 05: Sub-Dword Addressing (SDWA) ──

const SDWA_TUTORIAL: Tutorial = {
  id: 'tut-sdwa',
  title: 'Sub-Dword Addressing',
  description: 'Extract and manipulate individual bytes and 16-bit words within 32-bit registers using SDWA modifiers.',
  steps: [
    {
      title: 'What is SDWA?',
      text:
        'GPU registers are 32 bits wide, but data often comes in smaller pieces — 8-bit color channels, 16-bit integers, packed formats. <strong>SDWA</strong> (Sub-Dword Addressing) lets you operate on individual <em>bytes</em> or <em>words</em> within a register without manual shifting and masking.\n\n' +
        'SDWA is a <em>modifier</em> on existing VOP1/VOP2 instructions. It adds source selectors (which part to read), destination selectors (which part to write), and sign/zero extension — all in a single instruction.',
    },
    {
      title: 'Source Selectors',
      text:
        'The <code>src0_sel</code> modifier selects which portion of the source register to use:\n\n' +
        '• <code>BYTE_0</code> — bits [7:0] (lowest byte)\n' +
        '• <code>BYTE_1</code> — bits [15:8]\n' +
        '• <code>BYTE_2</code> — bits [23:16]\n' +
        '• <code>BYTE_3</code> — bits [31:24] (highest byte)\n' +
        '• <code>WORD_0</code> — bits [15:0] (lower 16 bits)\n' +
        '• <code>WORD_1</code> — bits [31:16] (upper 16 bits)\n' +
        '• <code>DWORD</code> — all 32 bits (default)\n\n' +
        'Try this: v0 is loaded with <code>0xAABBCCDD</code>. We extract each byte into separate registers. Switch VGPRs to <strong>HEX</strong> mode to see the results clearly.',
      code: '; v0 = 0xAABBCCDD\nv_mov_b32 v0, 0xAABBCCDD\n;\n; Extract each byte\nv_mov_b32 v1, v0 src0_sel:BYTE_0\nv_mov_b32 v2, v0 src0_sel:BYTE_1\nv_mov_b32 v3, v0 src0_sel:BYTE_2\nv_mov_b32 v4, v0 src0_sel:BYTE_3\n;\n; Extract each word\nv_mov_b32 v5, v0 src0_sel:WORD_0\nv_mov_b32 v6, v0 src0_sel:WORD_1\ns_endpgm',
    },
    {
      title: 'Sign Extension',
      text:
        'By default, the extracted sub-dword is <strong>zero-extended</strong> to 32 bits. Adding <code>src0_sext</code> <strong>sign-extends</strong> instead — the top bit of the selected portion is replicated into the upper bits.\n\n' +
        'This matters when working with signed data packed into bytes. For example, the signed byte <code>0xFF</code> is -1, but zero-extended it becomes 255.\n\n' +
        'Try this: v0 has <code>0x00000080</code> (byte 0 = 0x80 = -128 as signed). Without sext, extracting BYTE_0 gives 0x80 (128). With sext, it gives 0xFFFFFF80 (-128).\n\n' +
        'Switch VGPRs to <strong>I32</strong> mode to see the signed interpretation.',
      code: '; v0 = 0x80 (byte 0 = -128 signed)\nv_mov_b32 v0, 0x00000080\n;\n; Zero-extend (default): 0x80 = 128\nv_mov_b32 v1, v0 src0_sel:BYTE_0\n;\n; Sign-extend: 0xFFFFFF80 = -128\nv_mov_b32 v2, v0 src0_sel:BYTE_0 src0_sext\ns_endpgm',
    },
    {
      title: 'Destination Selectors',
      text:
        '<code>dst_sel</code> controls which portion of the destination register to write. Combined with <code>dst_unused</code>, you control what happens to the bits you <em>don\'t</em> write:\n\n' +
        '• <code>dst_unused:UNUSED_PAD</code> — zero the unused bits (default)\n' +
        '• <code>dst_unused:UNUSED_SEXT</code> — sign-extend the written portion\n' +
        '• <code>dst_unused:UNUSED_PRESERVE</code> — keep the old destination value in unused bits\n\n' +
        'Try this: we write a value into BYTE_1 of the destination, with different unused modes. Switch to <strong>HEX</strong> to see how the surrounding bytes differ.',
      code: '; Source: v0 = 0x42 (the value to write)\nv_mov_b32 v0, 0x42\n;\n; Write to BYTE_1, pad unused with zeros\nv_mov_b32 v1, v0 dst_sel:BYTE_1 dst_unused:UNUSED_PAD\n; Result: 0x00004200\n;\n; Write to BYTE_1, preserve rest\nv_mov_b32 v2, 0xFFFFFFFF\nv_mov_b32 v2, v0 dst_sel:BYTE_1 dst_unused:UNUSED_PRESERVE\n; Result: 0xFFFF42FF\ns_endpgm',
    },
    {
      title: 'Practical Example: Byte Swap',
      text:
        'SDWA makes byte manipulation trivial. Here\'s a common operation: swapping the low and high bytes of a 16-bit word (endian swap of the lower 16 bits).\n\n' +
        'Without SDWA, this requires multiple shift and mask instructions. With SDWA, we extract BYTE_0 and BYTE_1 separately and reassemble them.\n\n' +
        'v0 starts with <code>0x00001234</code>. After the swap, the lower 16 bits become <code>0x3412</code>.',
      code: '; v0 = 0x00001234\nv_mov_b32 v0, 0x00001234\n;\n; Extract byte 0 (0x34), write to byte 1 position\nv_mov_b32 v1, v0 src0_sel:BYTE_0 dst_sel:BYTE_1 dst_unused:UNUSED_PAD\n;\n; Extract byte 1 (0x12), write to byte 0, preserve byte 1\nv_mov_b32 v1, v0 src0_sel:BYTE_1 dst_sel:BYTE_0 dst_unused:UNUSED_PRESERVE\n; v1 = 0x00003412 (bytes swapped!)\ns_endpgm',
    },
    {
      title: 'SDWA with ALU Operations',
      text:
        'SDWA isn\'t just for moves — it works with any VOP1/VOP2 instruction. You can add bytes, multiply words, or compare sub-dword values directly.\n\n' +
        'Both sources can have independent selectors with <code>src0_sel</code> and <code>src1_sel</code>. This lets you do things like "add byte 0 of v0 to byte 2 of v1" in a single instruction.\n\n' +
        'Try this: we add the low byte of v0 to the high byte of v1, storing the result as a full dword.',
      code: '; v0 = 0x00000003 (byte 0 = 3)\nv_mov_b32 v0, 0x00000003\n; v1 = 0x05000000 (byte 3 = 5)\nv_mov_b32 v1, 0x05000000\n;\n; Add byte 0 of v0 + byte 3 of v1 → v2\nv_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_3\n; v2 = 8 (3 + 5)\ns_endpgm',
    },
    {
      title: 'Key takeaways',
      text:
        'SDWA in summary:\n\n' +
        '• <strong>Source selectors</strong> (<code>src0_sel</code>, <code>src1_sel</code>) pick which byte or word to read — no manual shifting needed.\n\n' +
        '• <strong>Sign extension</strong> (<code>src0_sext</code>) interprets the sub-dword as signed and extends to 32 bits.\n\n' +
        '• <strong>Destination selectors</strong> (<code>dst_sel</code>) write to a specific byte/word position, with <code>dst_unused</code> controlling the rest.\n\n' +
        '• Works on any VOP1/VOP2 instruction — moves, adds, multiplies, comparisons.\n\n' +
        '• Eliminates common shift-and-mask patterns, saving instructions when packing/unpacking data.',
    },
  ],
};

// ── Tutorial 06: Packed FP16 ──

const PACKED_FP16: Tutorial = {
  id: 'tut-packed-fp16',
  title: 'Packed FP16',
  description: 'Double your throughput by processing two half-precision floats per instruction with VOP3P.',
  steps: [
    {
      title: 'Why Half Precision?',
      text:
        'Full 32-bit float (f32) gives ~7 digits of precision, but many workloads don\'t need that much. <strong>Half precision</strong> (f16, 16-bit float) gives ~3.5 digits — plenty for neural networks, image processing, and many graphics operations.\n\n' +
        'The key advantage: since f16 is half the size of f32, AMD GPUs can process <strong>two f16 values in a single 32-bit register</strong>. The <code>v_pk_*</code> (packed) instructions operate on both halves simultaneously, effectively <strong>doubling your throughput</strong> for free.\n\n' +
        'This is why ML training moved to f16 — the same hardware does twice the work per cycle.',
    },
    {
      title: 'Packed Register Layout',
      text:
        'A single 32-bit VGPR holds two f16 values:\n\n' +
        '• <strong>Lo half</strong> — bits [15:0] — the lower f16 value\n' +
        '• <strong>Hi half</strong> — bits [31:16] — the upper f16 value\n\n' +
        'When you look at the register in <strong>F16 mode</strong> (click the F16 button in the VGPRs panel), each register splits into <code>v0.lo</code> and <code>v0.hi</code> columns showing both halves.\n\n' +
        'The <code>v_pk_*</code> instructions process both halves in parallel — one instruction, two results.',
    },
    {
      title: 'Your First Packed Add',
      text:
        'Let\'s try <code>v_pk_add_f16</code>. This adds the lo halves together and the hi halves together in a single instruction.\n\n' +
        'We pack two values into each register:\n' +
        '• v0 = {hi: 3.0, lo: 1.0}\n' +
        '• v1 = {hi: 4.0, lo: 2.0}\n\n' +
        'After <code>v_pk_add_f16 v2, v0, v1</code>:\n' +
        '• v2.lo = 1.0 + 2.0 = <strong>3.0</strong>\n' +
        '• v2.hi = 3.0 + 4.0 = <strong>7.0</strong>\n\n' +
        'Switch the VGPRs panel to <strong>F16</strong> mode and step through to see both halves update.',
      code: '; Pack f16 values: v0 = {3.0, 1.0}, v1 = {4.0, 2.0}\n; f16(1.0)=0x3C00, f16(2.0)=0x4000\n; f16(3.0)=0x4200, f16(4.0)=0x4400\nv_mov_b32 v0, 0x42003C00\nv_mov_b32 v1, 0x44004000\n;\n; Packed add: both halves in one instruction\nv_pk_add_f16 v2, v0, v1\ns_endpgm',
    },
    {
      title: 'Packed Multiply',
      text:
        '<code>v_pk_mul_f16</code> multiplies both halves independently. Combined with <code>v_pk_add_f16</code>, you can build efficient dot products, matrix multiplies, and convolutions on f16 data.\n\n' +
        'There\'s also <code>v_pk_fma_f16</code> — a fused multiply-add that does <code>a*b+c</code> on both halves in one instruction. This is the workhorse of neural network inference.\n\n' +
        'Step through this example: multiply two packed pairs, then FMA with an accumulator.',
      code: '; v0 = {2.0, 3.0}, v1 = {4.0, 5.0}\nv_mov_b32 v0, 0x40004200\nv_mov_b32 v1, 0x44004500\n;\n; Packed multiply: lo=3*5=15, hi=2*4=8\nv_pk_mul_f16 v2, v0, v1\n;\n; FMA: v3 = v0 * v1 + v2 (accumulate)\n; lo = 3*5+15 = 30, hi = 2*4+8 = 16\nv_pk_fma_f16 v3, v0, v1, v2\ns_endpgm',
    },
    {
      title: 'The Full Packed Toolkit',
      text:
        'VOP3P includes a complete set of packed f16 operations:\n\n' +
        '🔢 <strong>Floating point:</strong> <code>v_pk_add_f16</code>, <code>v_pk_mul_f16</code>, <code>v_pk_fma_f16</code>\n\n' +
        '📊 <strong>Min/Max:</strong> <code>v_pk_min_f16</code>, <code>v_pk_max_f16</code>\n\n' +
        '🔧 <strong>Integer:</strong> <code>v_pk_add_u16</code>, <code>v_pk_mul_lo_u16</code>, <code>v_pk_lshlrev_b16</code>, <code>v_pk_max/min_i16/u16</code>, and more\n\n' +
        '🔄 <strong>Mixed precision:</strong> <code>v_fma_mix_f32</code> — takes a mixture of f16 and f32 inputs and produces an f32 output, bridging between precision levels\n\n' +
        'All VOP3P instructions use the <code>0x33</code> encoding prefix and have OP_SEL/OP_SEL_HI modifiers to control which half of each source to read.',
    },
    {
      title: 'OP_SEL — Half Selection',
      text:
        'By default, the lo operation reads from the lo half and the hi operation reads from the hi half. <strong>op_sel</strong> overrides the <em>lo</em> operation\'s source selection, and <strong>op_sel_hi</strong> overrides the <em>hi</em> operation\'s.\n\n' +
        '<code>op_sel:[src0_bit, src1_bit]</code> — for the <em>lo</em> result: 0 = read lo half, 1 = read hi half\n' +
        '<code>op_sel_hi:[src0_bit, src1_bit]</code> — for the <em>hi</em> result: same meaning\n\n' +
        'Try this: v0 = {hi: 2.0, lo: 1.0}. With <code>op_sel:[0,0]</code> the lo operation adds lo+lo = 1+1 = 2. With default op_sel_hi, the hi operation adds hi+hi = 2+2 = 4. So v1 = {4.0, 2.0}.\n\n' +
        'Switch to <strong>F16</strong> mode to see the halves.',
      code: '; v0 = {hi: 2.0, lo: 1.0}\n; f16(1.0)=0x3C00, f16(2.0)=0x4000\nv_mov_b32 v0, 0x40003C00\n;\n; Default: lo=lo+lo, hi=hi+hi → {4.0, 2.0}\nv_pk_add_f16 v1, v0, v0\n;\n; op_sel:[1,0]: lo reads (hi + lo) = 2+1 = 3\n; op_sel_hi default: hi reads (hi + hi) = 2+2 = 4\n; Result: {4.0, 3.0}\nv_pk_add_f16 v2, v0, v0 op_sel:[1,0]\n;\n; op_sel:[1,1]: lo reads (hi + hi) = 2+2 = 4\n; hi still reads (hi + hi) = 4 → {4.0, 4.0}\n; Broadcasts the hi value to both halves!\nv_pk_add_f16 v3, v0, v0 op_sel:[1,1]\ns_endpgm',
    },
    {
      title: 'OP_SEL_HI — Hi-Half Override',
      text:
        '<code>op_sel_hi</code> controls what the <em>hi</em> operation reads. By default all sources read from their hi half (op_sel_hi = [1,1]). Setting a bit to 0 makes the hi operation read from the <em>lo</em> half instead.\n\n' +
        'This is how you broadcast the lo value to both halves:\n' +
        '<code>op_sel_hi:[0,0]</code> — hi operation reads lo halves (same as lo operation)\n\n' +
        'Step through: v0 = {hi: 5.0, lo: 3.0}. With <code>op_sel_hi:[0,0]</code>, both lo and hi operations read the lo halves and add them: 3+3 = 6 in both positions → v1 = {6.0, 6.0}.',
      code: '; v0 = {hi: 5.0, lo: 3.0}\n; f16(3.0)=0x4200, f16(5.0)=0x4500\nv_mov_b32 v0, 0x45004200\n;\n; Default: lo=lo+lo=6, hi=hi+hi=10 → {10.0, 6.0}\nv_pk_add_f16 v1, v0, v0\n;\n; op_sel_hi:[0,0]: hi also reads lo halves\n; Both operations: lo+lo = 3+3 = 6 → {6.0, 6.0}\nv_pk_add_f16 v2, v0, v0 op_sel_hi:[0,0]\n;\n; Combine: op_sel:[1,1] op_sel_hi:[1,1]\n; Both operations read hi: 5+5 = 10 → {10.0, 10.0}\nv_pk_add_f16 v3, v0, v0 op_sel:[1,1] op_sel_hi:[1,1]\ns_endpgm',
    },
    {
      title: 'Performance: 2× Throughput',
      text:
        'The key insight for performance:\n\n' +
        '• One <code>v_pk_add_f16</code> does the same work as <strong>two</strong> <code>v_add_f32</code> instructions\n' +
        '• Same cycle count, same register pressure, twice the data\n' +
        '• For workloads that can tolerate f16 precision, this is a free 2× speedup\n\n' +
        'Real-world uses:\n' +
        '• <strong>Neural networks</strong> — training and inference in f16/mixed precision\n' +
        '• <strong>Image processing</strong> — HDR images stored as f16\n' +
        '• <strong>Physics simulation</strong> — particle systems, fluid dynamics at reduced precision\n' +
        '• <strong>Audio processing</strong> — f16 is more than enough for audio samples\n\n' +
        'The puzzles ahead will challenge you to use packed operations to solve problems in half the instructions.',
    },
  ],
};

// ── All Tutorials ──

export const ALL_TUTORIALS: Tutorial[] = [
  WELCOME_TO_GPU,
  BRANCHING,
  INTRA_WAVE,
  SDWA_TUTORIAL,
  PACKED_FP16,
];

export function getTutorialById(id: string): Tutorial | undefined {
  return ALL_TUTORIALS.find(t => t.id === id);
}
