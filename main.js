function start() {
    const scroll = new Scroll();
    this.menu = new Menu();

    const setFunc = () => {
        if (isInstantiated) {
            menu.setFunction(Module.cwrap('synthesis', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
                Module.cwrap('my_mgc2sp', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']));
        }
        else {
            setTimeout(setFunc, 300);
        }
    };
    setFunc();

    //画面のリサイズ処理の登録
    (function () {
        let timeout;
        window.onresize = () => {
            clearTimeout(timeout);

            timeout = setTimeout(() => {
                document.getElementById('piano').width = document.getElementById('piano-container').clientWidth;
                menu.resize();
            }, 100);
        }
    })();

};

const modes = {
    'select': 0,
    'pen': 1,
    'erase': 2
};


let isInstantiated = false;
Module.onRuntimeInitialized = () => {
    isInstantiated = true;
}
