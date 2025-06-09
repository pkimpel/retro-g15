/***********************************************************************
* retro-g15/webUI SoundWorklet.js
************************************************************************
* Copyright (c) 2025, Bill Kuker.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 sound worklet support module for Sound.js.
************************************************************************
* 2025-05-09  B.Kuker
*   Original version.
***********************************************************************/

import { wordBits, drumRPM } from "../emulator/Util.js";

//Calculate G15 sample rate
const drumSampleRate = (() => {
  const drumWords = 124;
  const bits = drumWords * wordBits;
  const rps = drumRPM / 60;
  return bits * rps;
})();

//Each output sample is this many drum samples
//Drum sample rate is about 100khz which is a
//lot higher than most sound cards
const ratio = drumSampleRate / sampleRate;

/*
console.log("Drum Sample Rate", drumSampleRate);
console.log("Audio Context Sample Rate", sampleRate);
console.log("Ratio", ratio);
*/

class RandomNoiseProcessor extends AudioWorkletProcessor {

  constructor(...args) {
    super(...args);

    //The buffer containing the combined audio
    //from all the lines
    this.buf = null;

    //The pointer into the buffer where we are
    //reading
    this.ptr = 0;

    //Save the buffer sent from the main tread
    this.port.onmessage = (e) => {
      const buffer = e.data;
      this.buf = new Float32Array(buffer);
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.buf){
      //No data yet
      return true;
    }

    outputs[0].forEach((channel) => {
      let p = this.ptr;
      for (let i = 0; i < channel.length; i++) {
        //Increment the pointer by the sample ratio
        //and wrap it circularly around the buffer
        p = (p + ratio ) % this.buf.length;

        //Put the right sample to the output
        channel[i] = this.buf[ Math.floor(p) ];
      }
      this.ptr = p;
    });
    return true;
  }
}

registerProcessor("SoundWorklet", RandomNoiseProcessor);