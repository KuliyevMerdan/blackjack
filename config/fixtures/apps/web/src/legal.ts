// FIXTURE — must NOT be flagged: the web shell's allow-list, everything but the engine.
import { connect } from '@blackjack/client-core';
import { direct } from '@blackjack/director';
import { Table } from '@blackjack/renderer';
import { schema } from '@blackjack/protocol';
import { minor } from '@blackjack/money';
import { value } from '@blackjack/cards';
import { shoe } from '@blackjack/fair';
import { recommend } from '@blackjack/strategy';
import { Application } from 'pixi.js';
import { gsap } from 'gsap';

export const ok = [
  connect,
  direct,
  Table,
  schema,
  minor,
  value,
  shoe,
  recommend,
  Application,
  gsap,
];
