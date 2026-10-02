// FIXTURE — must NOT be flagged: the renderer reading cards and driving Pixi and GSAP.
import { value } from '@blackjack/cards';
import { Application } from 'pixi.js';
import { gsap } from 'gsap';

export const ok = [value, Application, gsap];
