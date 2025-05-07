export { Sound };

import * as Util from "../emulator/Util.js";
import { BitField } from "../emulator/BitField.js";

class Sound {
  //The per line contribution to the audio sigbal (+/-)
  static LINE_SIGNAL_STRENGTH = 0.01;

  //How often to resample the drum
  static RESAMPLE_MS = 33;

  constructor(context) {
    this.drum = context.processor.drum;
    this.audioCtx = new AudioContext();
    this._intervalID = false;
    this._lines = [];

    //Create a buffer for the sound...
    let bits = 124 * Util.wordBits;
    let rps = Util.drumRPM / 60;
    let sps = bits * rps;
    this.rawSampleBuffer = this.audioCtx.createBuffer(
      1, //channels
      Util.longLineSize * Util.wordBits, //One sample per BIT
      sps //Samples per second
    );

    //Create audio source using the buffer
    this.bufferSource = this.audioCtx.createBufferSource();
    this.bufferSource.buffer = this.rawSampleBuffer;
    this.bufferSource.loop = true; //Drum spins round and round

    //Connect to the audio context
    this.gainNode = this.audioCtx.createGain();
    this.bufferSource.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.bufferSource.start();

    this.enabled = false;
  }

  updateAudio() {
    /* Update the audio buffer with values based on the currently tapped lines */
    if (this._enabled) {
      const buf = this.rawSampleBuffer.getChannelData(0);
      buf.fill(0);

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

    //Stop the old one
    this.bufferSource.stop();

    //Create audio source using the buffer
    this.bufferSource = this.audioCtx.createBufferSource();
    this.bufferSource.buffer = this.rawSampleBuffer;
    this.bufferSource.loop = true; //Drum spins round and round
    this.bufferSource.connect(this.gainNode);
    this.bufferSource.start();

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
