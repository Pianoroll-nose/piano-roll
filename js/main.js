function start() {
    const scroll = new Scroll();
    this.menu = new Menu();

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
