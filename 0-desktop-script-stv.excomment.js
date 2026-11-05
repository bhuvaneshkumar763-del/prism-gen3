// stv.comment.js

(function(w,d){
    var forSource = {
        "faloo": { perbook: true },
        "qidian": { firstchap: true, perchapter: true, perline: true , yousuu: false },
        "ciweimao": { perbook: true, perline: true },
        "fanqie": { perbook: true },
        "jjwxc": { perbook: true, perchapter: true , yousuu: true },
    };
    var getHiddenId = function(){
        var e = g("hiddenid");
        if(!e){
            return ["0","0","none"];
        }
        return e.textContent.split(";");
    }
    var host = "", chapter = "", book = "", pageType = "book", bookName = w.bookinfo ? w.bookinfo.bookname : "";
    var init = function(){
        var hiddenid = getHiddenId();
        host = hiddenid[2];
        chapter = hiddenid[1];
        book = hiddenid[0];
        pageType = chapter == "0" ? "book" : "chapter";
        if(host in forSource){
            var source = forSource[host];
            if(source.perchapter && chapter != "0"){
                cui.enableShowPerChapter();
            }else if(source.perbook){
                cui.enableShowPerBook();
            }else if(source.firstchap){
                cui.enableShowFirstChap();
            }
            if(pageType == "book" && source.yousuu){
                cui.enableShowYousuu();
            }
            if(pageType == "chapter" && source.perline){
                cui.enableShowPerLine();
            }
        }
    };
    var fetchExternalComment = function(type, container, ele){
        var url = `https://excomment.sangtacvietcdn.xyz/excomment/${type}/${host}/${book}/${window.firstCid||chapter}`;
        if(type == "yousuu"){
            url = `https://excomment.sangtacvietcdn.xyz/excomment/${type}/${encodeURIComponent(bookName)}`;
        }
        var xhr = new XMLHttpRequest();
        xhr.open("GET",url,true);
        xhr.onreadystatechange = function(){
            if(xhr.readyState == 4){
                if(xhr.status == 200){
                    var data = JSON.parse(xhr.responseText);
                    if(data.status == 0){
                        if(ele){
                            ele.remove();
                        }
                        cui.showComment(data.data, container);
                    }else{
                        cui.showCommentError(data.message);
                    }
                }else{
                    cui.showCommentError("Tải dữ liệu thất bại");
                }
            }
        };
        xhr.send();
    };
    var fetchExternalCommentCountPerLine = function(){
        return false;
        var url = `https://excomment.sangtacvietcdn.xyz/excomment/count/${host}/${book}/${chapter}`;
        var xhr = new XMLHttpRequest();
        xhr.open("GET",url,true);
        xhr.onreadystatechange = function(){
            if(xhr.readyState == 4){
                if(xhr.status == 200){
                    var data = JSON.parse(xhr.responseText);
                    if(data.status == 0){
                        cui.showCommentCountPerLine(data.data);
                    }
                }
            }
        };
        xhr.send();
    }
    var fetchExternalCommentForLine = function(line){
        var url = `https://excomment.sangtacvietcdn.xyz/excomment/line/${host}/${book}/${chapter}/${line}`;
        var xhr = new XMLHttpRequest();
        xhr.open("GET",url,true);
        xhr.onreadystatechange = function(){
            if(xhr.readyState == 4){
                if(xhr.status == 200){
                    var data = JSON.parse(xhr.responseText);
                    if(data.status == 0){
                        cui.showCommentForLine(data.data);
                    }
                }
            }
        };
        xhr.send();
    }
    var cui = {
        enableButton: function(buttonid, setType = false){
            var ele = g(buttonid);
            if(!ele){return;}
            ele.style.display = "block";
            ele.addEventListener("click", function(){
                fetchExternalComment(ele.getAttribute("data-type"), g(ele.getAttribute("data-target")), ele);
                ele.innerHTML = `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Đang tải...</span></div>`;
                ele.disabled = true;
            });
            if(setType){
                ele.setAttribute("data-type", setType);
            }
        },
        enableShowPerBook: function(){
            this.enableButton("show-per-book", "perbook");
        },
        enableShowFirstChap: function(){
            this.enableButton("show-per-book", "perbook");
        },
        enableShowPerChapter: function(){
            this.enableButton("show-per-book", "perchapter");
        },
        enableShowPerLine: function(){
            fetchExternalCommentCountPerLine();
        },
        enableShowYousuu: function(){
            this.enableButton("show-yousuu");
        },
        htmlenities: function(obj){
            var r = /[a-z]/;
            for(var i in obj){
                if(obj[i].substring && r.test(obj[i])){
                    obj[i] = obj[i].replace(/&/g, "&amp;");
                    obj[i] = obj[i].replace(/</g, "&lt;");
                    obj[i] = obj[i].replace(/>/g, "&gt;");
                    obj[i] = obj[i].replace(/"/g, "&quot;");
                    obj[i] = obj[i].replace(/'/g, "&#039;");
                    obj[i] = obj[i].replace(/&lt;br ?\/?&gt;/g, "<br>");
                }
            }
        },
        createComment: function(comment, mgLeft = ""){
            var ele = d.createElement("div");
            ele.className = "flex";
            var time = comment.time;
            try{
                var ttime = new Date(time);
                var now = new Date();
                var diff = now - ttime;
                var sec = Math.floor(diff / 1000);
                var min = Math.floor(sec / 60);
                var hour = Math.floor(min / 60);
                var day = Math.floor(hour / 24);
                var month = Math.floor(day / 30);
                var year = Math.floor(month / 12);
                if(year > 0){
                    time = `${year} năm trước`;
                }
                else if(month > 0){
                    time = `${month} tháng trước`;
                }
                else if(day > 0){
                    time = `${day} ngày trước`;
                }
                else if(hour > 0){
                    time = `${hour} giờ trước`;
                }
                else if(min > 0){
                    time = `${min} phút trước`;
                }
                else if(sec > 0){
                    time = `${sec} giây trước`;
                }
            }catch(e){}
            this.htmlenities(comment);
            ele.innerHTML = `
                <img src="${comment.avatar || "/default.png"}" class="comment-avatar"${mgLeft} referrerpolicy="no-referrer">
                <div class="sec" style="flex:1;margin-left:6px;">
                    <div class="sec-top bg-gray">${comment.content}</div>
                    <div class="sec-bot">
                        <div class="ilb t-14 pv-0" style="padding:0 4px">
                            <a style="color:#535353" ${comment.userLink ? `href="${comment.userLink}"` : ""}>${comment.user}</a> - 
                            <span class="timeelap t-12 t-gray">${time}</span>
                            ${comment.like ? `<span class="t-12 t-gray"> - ${comment.like} <i class="fas fa-thumbs-up"></i></span>` : ""}
                            ${comment.dislike ? `<span class="t-12 t-gray"> - ${comment.dislike} <i class="fas fa-thumbs-down"></i></span>` : ""}
                        </div>
                    </div>
                </div>`;
            return ele;
        },
        showComment: function(resp, ele){
            var container = d.createElement("div");
            container.className = "comment-container";
            var comments = resp.comments;
            for(var i = 0; i < comments.length; i++){
                container.appendChild(this.createComment(comments[i]));
                var replies = comments[i].replies;
                if(replies && replies.length > 0)
                for(var j = 0; j < replies.length; j++){
                    container.appendChild(this.createComment(replies[j], ` style="margin-left:50px"`));
                }
            }
            if(resp.next){
                container.appendChild(this.createShowNextButton(function(e){
                    fetchExternalComment(resp.next, container, e.target);
                    e.innerHTML = `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Đang tải...</span></div>`;
                    e.disabled = true;
                }));
            }
            ele.appendChild(container);
        },
        createShowNextButton: function(fun){
            var ele = d.createElement("div");
            ele.className = "show-next";
            ele.innerHTML = `<button style="width:100%" class="btn btn-primary btn-sm">Xem thêm</button>`;
            ele.addEventListener("click", fun);
            return ele;
        },
    };

    if(w.enableExternalComment){
        init();
    }
})(window,document);
