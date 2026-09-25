// In-game time: minutes tick while playing; the game reacts to every
// ten minutes and every hour, and to the 2 am collapse.
import { DAY_END, DAY_LENGTHS, SEASONS } from './state.js';
import { WEATHER_ODDS } from '../data/world_data.js';
import { weighted } from './util.js';

export class Clock {
  constructor(game) {
    this.game = game;
    this.lastTen = -1;
    this.lastHour = -1;
    this.running = true;
  }

  get state() { return this.game.state; }
  get minutes() { return this.state.time; }
  get hour() { return this.state.time / 60; }
  get season() { return SEASONS[this.state.seasonIndex % 4]; }

  secPerMinute() {
    return DAY_LENGTHS[this.game.settings.dayLength] || DAY_LENGTHS.normal;
  }

  update(dt) {
    if (!this.running) return;
    const st = this.state;
    st.time += dt / this.secPerMinute();
    const ten = Math.floor(st.time / 10);
    if (ten !== this.lastTen) {
      this.lastTen = ten;
      this.game.onTenMinutes && this.game.onTenMinutes();
    }
    const h = Math.floor(st.time / 60);
    if (h !== this.lastHour) {
      this.lastHour = h;
      this.game.onHour && this.game.onHour(h % 24);
    }
    if (st.time >= DAY_END) {
      st.time = DAY_END;
      this.running = false;
      this.game.passOut();
    }
  }

  static rollWeather(season, rnd = Math.random) {
    const odds = WEATHER_ODDS[season] || WEATHER_ODDS.spring;
    return weighted(Object.entries(odds), rnd);
  }
}
