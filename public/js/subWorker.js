importScripts('realtimeSynthesis.js');

self.addEventListener('message', (e) => {
    const message = e.data.message;
    if (message === 'synthesis') {
        const args = e.data.args;
        self.synthesis(
            args.f_p, args.fs, ptrs.f0, args.f0_length, ptrs.mgc, args.mel_points, 
            ptrs.ap_ptr, args.fft_size, args.out_length, ptrs.out
        );

        Object.keys(self.ptrs).forEach(function (k) {
            Module._free(self.ptrs[k]);
        });

        self.postMessage({
            message: 'finish'
        });
    }
}, false);

self.ptrs = {};
self.addEventListener('message', (e) => {
    const message = e.data.message;
    if (message === 'malloc') {
        self.ptrs[e.data.name] = Module._malloc(e.data.size);
        const heap = new Uint8Array(Module.HEAPU8.buffer, self.ptrs[e.data.name], e.data.size);
        heap.set(new Uint8Array(e.data.buf));
        self.postMessage({
            message: 'malloc',
            ptr: self.ptrs[e.data.name]
        });
    }
});

Module.onRuntimeInitialized = () => {
    self.postMessage({
        message: 'init'
    });
    self.synthesis = Module.cwrap('synthesis', null, [
        'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'
    ]);
};
