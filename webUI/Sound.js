export { Sound };

import * as Util from "../emulator/Util.js";
import { BitField } from "../emulator/BitField.js";

class Sound {
  //The per line contribution to the audio sigbal (+/-)
  static LINE_SIGNAL_STRENGTH = 0.1;

  //How often to resample the drum
  static RESAMPLE_MS = 11;

  constructor(context) {
    this.drum = context.processor.drum;

    this._intervalID = false;
    this._lines = [];

    this.initAudio();
  }

  async initAudio() {
    /* Initialize audio and start the Audio Worklet */
    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    await this.audioCtx.audioWorklet.addModule("SoundWorklet.js");
    this.workletNode = new AudioWorkletNode(
      this.audioCtx,
      "SoundWorklet",
    );
    this.workletNode.connect(this.gainNode);

    this.lines = [2,3];
    this.enabled = true;
  }

  updateAudio() {
    /* Update the audio buffer with values based on the currently tapped lines */
    if (this._enabled) {
      const buf = new Float32Array(Util.longLineSize * Util.wordBits);

      //For every tapped line
      for (let line of this._lines) {
        let i = 0; //position in buffer
        //For every word in the specified line
        for (let word of this.drum.line[line]) {
          //For every bit in that word
          for (let bitNr = 0; bitNr < Util.wordBits; bitNr++) {
            //Put a value in the buffer
            if (BitField.bitTest(word, bitNr)) {
              buf[i] += Sound.LINE_SIGNAL_STRENGTH;
            } else {
              buf[i] -= Sound.LINE_SIGNAL_STRENGTH;
            }
            i++; //increment the position
          }
        }
      }
      const buffer = buf.buffer;
      this.workletNode.port.postMessage(buffer, [buffer]);
    }
  }

  set lines(l) {
    /*Accept either an array of lines, or a comma separated string.*/
    if (typeof l == "string") {
      //If string provided, assume comma separated list
      l = l.split(",");
      l = l.map((n) => parseInt(n, 10));
    }
    //Only valid lines
    l = l.filter((x) => x >= 0 && x <= 19);

    this._lines = l;
    this.enabled = this.lines.length > 0;
  }

  get lines() {
    /*Return the current set of lines being played*/
    return this._lines;
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(ena) {
    /*Set sound output enabled or disabled*/
    if (ena == this._enabled) {
      return; //If not changed, bail out.
    }
    this._enabled = ena;

    if (this._enabled) {
      //Enable sound

      //This is gross, but it was quick....
      //Sample the drum lines into an audio buffer
      //at a regular, but unsynchronized, rate.
      this._intervalID = setInterval(
        this.updateAudio.bind(this),
        Sound.RESAMPLE_MS
      );
      this.audioCtx.resume();
    } else {
      //Disable sound
      if (this._intervalID) {
        clearInterval(this._intervalID);
        this._intervalID = false;
      }
      this.audioCtx.suspend();
    }
  }
}
