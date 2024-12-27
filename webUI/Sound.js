export { Sound };

import * as Util from "../emulator/Util.js";
import { BitField } from "../emulator/BitField.js";

class Sound {
  //The per line contribution to the audio sigbal (+/-)
  static LINE_SIGNAL_STRENGTH = 0.01;
  static RESAMPLE_MS = 33;

  constructor(context) {
    this.drum = context.processor.drum;
    this._enabled = false;
    this.audioCtx = new AudioContext();

    this.lines = [19];

    //Create a buffer for the sound...
    const rawSampleBuffer = this.audioCtx.createBuffer(
      1, //channels
      Util.longLineSize * Util.wordBits, //One sample per BIT
      .5 * Util.longLineSize * Util.wordBits * (Util.drumRPM / 60) //Samples per second
    );

    //Create audio source using the buffer
    this.bufferSource = this.audioCtx.createBufferSource();
    this.bufferSource.buffer = rawSampleBuffer;
    this.bufferSource.loop = true; //Drum spins round and round

    //Connect to the audio context
    this.gainNode = this.audioCtx.createGain();
    this.bufferSource.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.bufferSource.start();

    //This is gross, but it was quick....
    //Sample the drum lines into an audio buffer
    //at a regular, but unsynchronized, rate.
    setInterval(() => {
      if (this._enabled) {
        //The buffer and the position in the buffer
        const buf = rawSampleBuffer.getChannelData(0);
        buf.fill(0);
        let i = 0;

        //For every tapped line
        for (let line of this.lines) {
          //For every word in lin 19
          for (let word of this.drum.line[19]) {
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
      }
    }, Sound.RESAMPLE_MS);

    this.enabled = true;
    this.gain = 1;
  }

  set gain(g){
    this.gainNode.gain.value = 1;
  }

  get enabled(){
    return this._enabled;
  }

  set enabled(ena) {
    if (ena == this._enabled) {
      return;
    }
    this._enabled = ena;
    if (this._enabled) {
      this.audioCtx.resume();
    } else {
      this.audioCtx.suspend();
    }
  }
}
