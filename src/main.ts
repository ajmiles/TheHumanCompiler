// ── Entry Point ──

import './styles/main.css';
import './styles/registers.css';
import './styles/editor.css';
import './styles/puzzle.css';
import './styles/leaderboard.css';
import { App } from './ui/app';

const root = document.getElementById('app')!;
new App(root);
