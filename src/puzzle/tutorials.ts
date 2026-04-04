// ── Tutorial Definitions ──

export interface TutorialStep {
  title: string;
  text: string;        // Rendered as HTML paragraphs
  code?: string;       // Pre-filled code for this step (sets editor content)
  highlight?: number;  // Line to highlight in the editor
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
        '<code>v_mov_b32 v1, 42</code>\n\n' +
        'This moves the value 42 into <code>v1</code> for every active lane. Press <strong>Step</strong> to execute it and watch the register panel update.',
      code: 'v_mov_b32 v1, 42\ns_endpgm',
    },
    {
      title: 'Adding two registers',
      text:
        'Now let\'s add two registers together:\n\n' +
        '<code>v_mov_b32 v0, 10</code> — load 10 into v0\n' +
        '<code>v_mov_b32 v1, 20</code> — load 20 into v1\n' +
        '<code>v_add_f32 v2, v0, v1</code> — add them as floats, store in v2\n\n' +
        'Step through each instruction and watch <code>v0</code>, <code>v1</code>, then <code>v2</code> fill in.',
      code: 'v_mov_b32 v0, 10\nv_mov_b32 v1, 20\nv_add_f32 v2, v0, v1\ns_endpgm',
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

// ── All Tutorials ──

export const ALL_TUTORIALS: Tutorial[] = [
  WELCOME_TO_GPU,
];

export function getTutorialById(id: string): Tutorial | undefined {
  return ALL_TUTORIALS.find(t => t.id === id);
}
