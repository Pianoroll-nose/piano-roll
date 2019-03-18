import Module from './synthesis.js';

class Synthesis extends AudioWorkletProcessor {
    constructor(context) {
        super();
        this.context = context;

        this.isInitialized = false;
        this.port.start();
        this.port.onmessage = e => this.handleMessage(e);
        this._synthesis = Module.cwrap('synthesis', null, [
            'number', 'number', 'number', 'number', 'number'
        ]);
        this.synthesized_len = 0;
        this.synthesis_count = 0;
        this.out_len = 0;
        this.current_pos = 0;
        this.returned = false;
        this.port.postMessage({
            message: 'init'
        });
    }

    init() {
        this.bufferSize = Math.ceil(128 / this.win_shift);
        this.bufferSize = 50;
        this.f0 = new Float64Heap(this.bufferSize);
        this.mcep = new Float64Heap(this.bufferSize * (this.order + 1));
        this.out = new Float64Heap((this.bufferSize - 1) * this.win_shift);
        this.inputs = {
            f0: null,
            mcep: null
        };
        this.output = null;
        this.isInitialized = true;
    }

    handleMessage(e) {
        if (e.data.message === 'init') {
            this.win_shift = e.data.win_shift;
            this.order = e.data.order;
            this.init();
        }
        if (e.data.message === 'synthesis') {
            this.count = 0;
            this.synthesized_len = 0;
            this.synthesis_count = 0;
            this.current_pos = 0;
            this.returned = false;
            this.inputs.f0 = e.data.args[0];
            this.inputs.mcep = e.data.args[1];

            this.out_len = this.inputs.f0.length - 1 < (this.inputs.mcep.length / (this.order + 1)) - 1 ?
                (this.inputs.f0.length - 1) * this.win_shift :
                (this.inputs.mcep.length / (this.order + 1) - 1) * this.win_shift;
            this.output = new Float32Array(this.out_len);
            //this.my_synthesis();
        }
    }

    process(inputs, outputs) {
        this.synthesis();
        if (this.out_len - this.current_pos > 0) {
            const output = outputs[0][0];
            for (let i = 0; i < output.length; i++) {
                //output[i] = inputs[0][0][i];
                output[i] = this.output[this.current_pos++];
            }
        }

        return true;
    }

    my_synthesis() {
        while (this.out_len - this.synthesized_len > 0) {
            this.f0 = new Float64Heap(this.inputs.f0.length);
            this.mcep = new Float64Heap(this.inputs.mcep.length);
            this.out = new Float64Heap(this.out_len);

            const f0_frames = Math.min(this.bufferSize, this.inputs.f0.length - this.synthesis_count);
            const mcep_frames = f0_frames * (this.order + 1);
            const out_frames = Math.min(f0_frames - 1 < (mcep_frames / (this.order + 1)) - 1 ?
                (f0_frames - 1) * this.win_shift :
                (mcep_frames / (this.order + 1) - 1) * this.win_shift, this.out_len - this.synthesized_len);

            this.f0.setBuffer(this.inputs.f0, this.synthesis_count, f0_frames);
            this.mcep.setBuffer(this.inputs.mcep, this.synthesis_count * (this.order + 1), mcep_frames);

            this._synthesis(this.f0.getAddress(), this.mcep.getAddress(), f0_frames, mcep_frames, this.out.getAddress());
            /*
            this.port.postMessage({
                message: 'check',
                data: this.out.getResultFloat32(out_frames)
            });
            */
            this.output.set(this.out.getResultFloat32(out_frames).slice(), this.synthesized_len);

            this.synthesis_count += this.bufferSize - 1;
            this.synthesized_len += out_frames;

            if (!this.returned && this.out_len <= this.synthesized_len) {
                const result = this.output.slice();
                this.port.postMessage({
                    message: 'finish',
                    result: result
                }, result.buffer);
                this.returned = true;
            }
        }
    }

    synthesis() {
        if (this.out_len - this.synthesized_len > 0) {
            const f0_frames = Math.min(this.bufferSize, this.inputs.f0.length - this.synthesis_count);
            const mcep_frames = f0_frames * (this.order + 1);
            const out_frames = Math.min(f0_frames - 1 < (mcep_frames / (this.order + 1)) - 1 ?
                (f0_frames - 1) * this.win_shift :
                (mcep_frames / (this.order + 1) - 1) * this.win_shift, this.out_len - this.synthesized_len);

            this.f0.setBuffer(this.inputs.f0, this.synthesis_count, f0_frames);
            this.mcep.setBuffer(this.inputs.mcep, this.synthesis_count * (this.order + 1), mcep_frames);

            this.port.postMessage({
                message: 'check',
                data: {'mcep': this.inputs.mcep}
            });

            this._synthesis(this.f0.getAddress(), this.mcep.getAddress(), f0_frames, mcep_frames, this.out.getAddress());
            /*
            this.port.postMessage({
                message: 'check',
                data: this.out.getResultFloat32(out_frames)
            });
            */

            this.output.set(this.out.getResultFloat32(out_frames).slice(), this.synthesized_len);

            console.log(this.synthesis_count);
            this.synthesis_count += this.bufferSize - 1;
            this.synthesized_len += out_frames;

            if (!this.returned && this.out_len <= this.synthesized_len) {
                const result = this.output.slice();
                this.port.postMessage({
                    message: 'finish',
                    result: result
                }, result.buffer);
                this.returned = true;
            }
        }
    }
}

registerProcessor('synthesis', Synthesis);


class Float64Heap {
    constructor(length) {
        this.size = length * 8;
        this.length = length;
        this.address = Module._malloc(this.size);
    }

    getLength() {
        return this.length;
    }

    getAddress() {
        return this.address;
    }

    getResultFloat32(length) {
        const result = new Float64Array(Module.HEAPU8.buffer, this.address, length);
        const max = result.reduce((l, r) => Math.max(Math.abs(l), Math.abs(r)), 1);
        const result_float = new Float32Array(result).map(e => e / max);
        return result_float;
    }

    setBuffer(float64Array, start, frames) {
        //const input = float64Array.subarray(start, start + frames);
        const heap = new Uint8Array(Module.HEAPU8.buffer, this.address, frames * 8);
        heap.set(new Uint8Array(float64Array.buffer, float64Array.byteOffset + start*8, frames*8));
        //heap.set(new Uint8Array(input.buffer, input.byteOffset, frames));
    }

    free() {
        Module._free(this.address);
    }
}