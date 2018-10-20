function start(){
    let bContainer = document.getElementById("bar-container");
    let pContainer = document.getElementById("piano-container");
    let eContainer = document.getElementById("editor-container");
    //canvasの幅をdivの幅に揃える
    document.getElementById('piano').width = pContainer.clientWidth;

    //スクロールを合わせる
    pContainer.addEventListener('scroll', () => {
        eContainer.scrollTop = pContainer.scrollTop;
    });

    eContainer.addEventListener('scroll', () => {
        pContainer.scrollTop = eContainer.scrollTop;
    });

    bContainer.addEventListener('scroll', () => {
        eContainer.scrollLeft = bContainer.scrollLeft;
    });

    eContainer.addEventListener('scroll', () => {
        bContainer.scrollLeft = eContainer.scrollLeft;
    });

    menu = new Menu();

    //画面のリサイズ処理の登録
    (function(){
        let timeout;
        window.onresize = () => {
            clearTimeout(timeout);

            timeout = setTimeout(() => {
                document.getElementById('piano').width = pContainer.clientWidth;
                menu.resize();
            }, 100);
        }
    })();

}