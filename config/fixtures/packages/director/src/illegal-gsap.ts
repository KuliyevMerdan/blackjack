// FIXTURE — must be rejected by `stage-libs-stay-on-stage`: timing is a number in a beat, not a tween.
import { gsap } from 'gsap';

export const leak = gsap;
