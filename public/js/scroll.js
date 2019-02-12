class Scroll {
    constructor() {
        this.pContainer = document.getElementById("piano-container");
        this.eContainer = document.getElementById("editor-container");
        this.v_scroll = document.getElementById("v-scroll");
        this.h_scroll = document.getElementById("h-scroll");
        this.v_thumb = document.getElementById('v-thumb');
        this.h_thumb = document.getElementById('h-thumb');
        this.piano = document.getElementById('piano');
        this.score = document.getElementById('score');
        this.cContainer = document.getElementById('canvas-container');

        this.piano.width = this.pContainer.clientWidth;
        this.lastClicked = {
            flag: [false, false],
            mouse_x: null,
            mouse_y: null,
            thumb_x: null,
            thumb_y: null
        };

        this.v_thumb.style.top = "0px";
        this.h_thumb.style.left = "0px";

        this.syncScroll();
        this.drag();
    }

    syncScroll() {
        this.pContainer.addEventListener('scroll', () => {
            this.eContainer.scrollTop = this.pContainer.scrollTop;
        });
        this.eContainer.addEventListener('scroll', () => {
            this.pContainer.scrollTop = this.eContainer.scrollTop;
        });

        this.eContainer.addEventListener('scroll', () => {
            this.v_thumb.style.top = (this.v_scroll.clientHeight - this.v_thumb.clientHeight) *
                this.eContainer.scrollTop / (this.score.clientHeight - this.eContainer.clientHeight + 20) + "px";
            this.h_thumb.style.left = (this.h_scroll.clientWidth - this.h_thumb.clientWidth) *
                this.eContainer.scrollLeft / (this.score.clientWidth - this.eContainer.clientWidth + 20) + "px";

        });
    }

    drag() {
        this.h_scroll.addEventListener('mousedown', (e) => {
            const x = e.clientX - this.h_scroll.getBoundingClientRect().left;
            const width = this.h_thumb.clientWidth;
            const left = parseInt(this.h_thumb.style.left.split('px')[0]);
            if (left <= x && x <= left + width) {
                this.lastClicked.flag[0] = true;
                this.lastClicked.mouse_x = e.clientX;
                this.lastClicked.thumb_x = left;
            }
            else {
                this.eContainer.scrollLeft = x * (this.score.clientWidth - this.eContainer.clientWidth + 20) /
                    (this.h_scroll.clientWidth - this.h_thumb.clientWidth);
            }
        });

        this.v_scroll.addEventListener('mousedown', (e) => {
            const y = e.clientY - this.v_scroll.getBoundingClientRect().top;
            const height = this.v_thumb.clientHeight;
            const top = parseInt(this.v_thumb.style.top.split('px')[0]);
            if (top <= y && y <= top + height) {
                this.lastClicked.flag[1] = true;
                this.lastClicked.mouse_y = e.clientY;
                this.lastClicked.thumb_y = top;
            }
            else {
                this.eContainer.scrollTop = y * (this.score.clientHeight - this.eContainer.clientHeight + 20) /
                    (this.v_scroll.clientHeight - this.v_thumb.clientHeight);
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.lastClicked.flag[0]) {
                const left = this.lastClicked.thumb_x + e.clientX - this.lastClicked.mouse_x;
                this.eContainer.scrollLeft = left * (this.score.clientWidth - this.eContainer.clientWidth + 20) /
                    (this.h_scroll.clientWidth - this.h_thumb.clientWidth);
            }
            if (this.lastClicked.flag[1]) {
                const top = this.lastClicked.thumb_y + e.clientY - this.lastClicked.mouse_y;
                this.eContainer.scrollTop = top * (this.score.clientHeight - this.eContainer.clientHeight + 20) /
                    (this.v_scroll.clientHeight - this.v_thumb.clientHeight);
            }
        });

        window.addEventListener('mouseup', () => {
            this.lastClicked.flag = [false, false];
        })
    }
}
