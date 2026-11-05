function followthisbook(){
	ajax("ajax=followbook&name="+encodeURIComponent(bookinfo.name)+"&author="+encodeURIComponent(bookinfo.author),function(down){
		ui.alert(down);
		if(down.contain("thành công") && isMobile && false){
			if(localStorage.getItem("autosetpush") != "3")
			if(localStorage.getItem("autosetpush") == "1" || confirm("Nhận thông báo truyện này trên màn hình chờ hay không?")){
				ui.scriptmanager.load("/stv.pushreg.js?v=3");
				setTimeout(function(){
					subscribeUser();
					ajax("ajax=userpushsubscribebook&b="+bookinfo.id+"&h="+bookinfo.host,function(d){
						if(d=="updated"){
							ui.notif("Thành công");
						}else if(d=="notsubscribed"){
							setTimeout(function(){
								isSCB(function(s){
									if(s){
										ajax("ajax=userpushsubscribebook&b="+bookinfo.id+"&h="+bookinfo.host,function(d){
											if(d=="updated"){
												ui.notif("Thêm thông báo màn hình chờ thành công");
											}else{
												ui.notif("Thêm thông báo màn hình chờ thất bại");
											}
										});
									}else{
										ui.notif("Thất bại");
									}
								});
							}, 500);
							
						}
					});							
				}, 500);

			}
		}
		if(down.contain("bỏ theo dõi")){
			ajax("ajax=userpushsubscribebook&b="+bookinfo.id+"&h="+bookinfo.host+"&m=disable",function(d){});	
		}
	});
}
function promote(){
	var s =  g("hiddenid").innerHTML.split(";");
	var bookid =s[0];
	var host = s[2];
	var xhttp = new XMLHttpRequest();
	var data = "ajax=promote&bookid="+bookid+"&host="+host;
	xhttp.open("POST", "/index.php", true);
	xhttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
	xhttp.onreadystatechange = function () {
		if (this.readyState == 4 && this.status == 200) {
			if(this.responseText=="success"){
				var i = parseInt(g("decu").innerHTML);
				g("decu").innerHTML=i+1;
				ui.notif("Thích truyện thành công");
			}else alert(this.responseText);
		}
	};
	xhttp.send(data);
}
function readnow(){
	var lastchapter=g("chaptercontainerinner").querySelector(".chaplastreaded");
	if(!lastchapter)
		g("chaptercontainerinner").querySelector(".listchapitem").click();
	else lastchapter.click();
}
function updateTusach(){
	var s= localStorage;
	var ss=s.getItem("tusach");
	var th = bookinfo.thumb;
	var sc = g("chaptercontainerinner").querySelectorAll("a").length;
	var na = bookinfo.namevi;
	var cn = "Đã để lại 1 tia thần thức";
	if(ss==null){
		var o={host:bookinfo.host,thumb:th,name:na,chapter:sc,id:bookinfo.id,current:+"0-,-"+cn};
		s.setItem("tusach",JSON.stringify(o));
	}else{
		var sss=ss.split("~/~");
		var arr=[];
		var flag=false;
		sss.forEach(function(e){
			if(e!=""){
				try{
					var f=JSON.parse(e);
					if(f.host==bookinfo.host&&f.id==bookinfo.id){
						f.chapter=sc;
						f.name=na;
						arr.unshift(JSON.stringify(f));
						flag=true;
					}
					else{
						arr.push(e);
					}
				}
				catch(ukne) {
					var f=e.split("~.~");
					var o={host:f[0],thumb:"/default.png",name:f[4],chapter:"?",id:f[2],current:f[3]+"-,-Chưa rõ tên"};
					arr.push(JSON.stringify(o));
				}
				
			}
		});
		if(!flag){
			var o={host:bookinfo.host,thumb:th,name:na,chapter:sc,id:bookinfo.id,current:"0-,-"+cn};
			arr.unshift(JSON.stringify(o));
		}
		s.setItem("tusach",arr.join("~/~"));
	}
	ajax("ajax=markbook&bid="+bookinfo.id+"&h="+bookinfo.host,function(){});
	alert("Đã để lại 1 tia thần thức");
}
function hidethisbook(){
	if(!confirm("Bạn xác nhận muốn che truyện này, hành động này khiến người khác mất cơ hội thưởng thức tác phẩm?")){
		return;
	}
	var s =  g("hiddenid").innerHTML.split(";");
	var bookid =s[0];
	var host = s[2];
	var xhttp = new XMLHttpRequest();
	var data = "ajax=hidebook&bookid="+bookid+"&host="+host;
	xhttp.open("POST", "/index.php", true);
	xhttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
	xhttp.onreadystatechange = function () {
				if (this.readyState == 4 && this.status == 200) {
					if(this.responseText=="success"){
						alert("truyện này đã bị che thành công");
					}else alert(this.responseText);
				}
	};
	 xhttp.send(data);
}
function writetruyenngon(){
	var md=createModal("Viết truyền ngôn");
	md.body().innerHTML="<textarea style='width:100%;min-height:160px' id='truyenngon'>Truyện hay lắm, mời các bạn cùng đọc!</textarea>";
	md.button("Dùng tóm tắt","usesumary()","btn-outline-secondary");
	md.button("Gửi","sendtruyenngon()","btn-outline-primary");
	
	md.id="modal-write-truyenngon";
	md.show();
}
function usesumary(){
	var sum=g("book-sumary").innerHTML;
	sum=sum.replace(/【 Phi lô[^】]+】 /,"");
	g("truyenngon").value= sum.substr(0,500)+"...";
}
var issending=false;
function sendtruyenngon(){
	if(issending){
		return;
	}else{
		issending=true;
		var bookdata=parseid();
		ajax("ajax=topic&sub=postnewtopic&image=&content="
			+encodeURIComponent(g("truyenngon").value)
			+"&link=http://sangtacviet.com/truyen/"+bookdata.host+"/1/"+bookdata.bookid+"/"
			,function(down){
					alert(down);
					issending=false;
					g("modal-write-truyenngon").hide();
			}) 
	}
}
//document.title=g("book_name2").innerText;
function updatebookstep(nstep){
	if(nstep!=bookstep){
		//if(bookstep!=2){
		//	renewchapter(true);
		//	return;
		//}
		ajax("sajax=updatebookstatus&step="+nstep+"&bookid="+bookinfo.id+"&host="+bookinfo.host);
	}
	
}
function recogending(){
	var days=timeElapsed(bookinfo.lastupdate).day;
	var lastbookstep=0;
	if(!g("bookstatus")){
		return;
	}
	if(isNaN(days)){
		if(bookstep==1){
			g("bookstatus").innerHTML='<i class="fas fa-star-half-alt"></i><br>' + localLang["Còn tiếp"];
		}else if(bookstep==2){
			g("bookstatus").innerHTML='<i class="fas fa-star-half"></i><br>' + localLang["Tạm ngưng"];
		}else if(bookstep==3){
			g("bookstatus").innerHTML='<i class="fas fa-star"></i><br>' + localLang["Hoàn thành"];
		}
		return;
	}
	if(days<3){
		var wb=q(".listchapitem");
		var endrgx=/toàn bổn|toàn bản|đại kết cục|xong bổn|xong bản|chung chương|hoàn tất cảm nghĩ|trọn bộ/i;
		for(var i=wb.length-1;i>wb.length-7&&i>=0;i--){
			if(endrgx.test(wb[i].innerHTML)){
				g("bookstatus").innerHTML='<i class="fas fa-star"></i><br>' + localLang["Hoàn thành"];
				lastbookstep=3;
				updatebookstep(3);
				return;
			}
		}
		g("bookstatus").innerHTML='<i class="fas fa-star-half-alt"></i><br>' + localLang["Còn tiếp"];
		lastbookstep=1;
		updatebookstep(1);
		return;
	}
	var wb=q(".listchapitem");
	var endrgx=/hoàn thành|toàn bổn|toàn bản|đại kết cục|ngoại truyện|chương cuối|phiên ngoại|xong bổn|xong bản|chung chương|kết thúc|sách mới|sách này|hoàn tất/i;
	for(var i=wb.length-1;i>wb.length-7&&i>=0;i--){
		if(endrgx.test(wb[i].innerHTML)){
			g("bookstatus").innerHTML='<i class="fas fa-star"></i><br>' + localLang["Hoàn thành"];
			lastbookstep=3;
			updatebookstep(3);
			return;
		}
	}
	if(days<8){
		g("bookstatus").innerHTML='<i class="fas fa-star-half-alt"></i><br>' + localLang["Còn tiếp"];
		lastbookstep=1;
		updatebookstep(1);
	}else{
		g("bookstatus").innerHTML='<i class="fas fa-star-half"></i><br>' + localLang["Tạm ngưng"];
		lastbookstep=2;
		updatebookstep(2);
	}
}
function showfillchaptermodal(){
	if(g("modal-fillchap")!=null){
		g("modal-fillchap").remove();
	}
	var md=createModal("Lấp hố");
	md.body().innerHTML="<button onclick=\"fillchapter()\" class='w-100 btn btn-secondary'>Nhấp để lấp hố chương vip, dành cho các nguồn: qidian, zongheng.</button>";
	md.setAttribute("id", "modal-fillchap");
	md.onhide=function(){
		$(this).fadeOut();
	}
	md.show();
}
var sk=0;
function fillchapter(){
	g("modal-fillchap").body().innerHTML="<center>Đang lấp hố, xin chờ...</center>";
	ajax("sajax=fillchapter&bookid="+bookinfo.id+"&host="+bookinfo.host+"&bookname="+encodeURIComponent(bookinfo.name)+"&sk="+sk,function(down){
		g("modal-fillchap").body().innerHTML=down+"<br><br><button onclick=\"fillchapter()\" class='w-100 btn btn-secondary'>Nhấp để cố lấp tiếp.</button>";
	});
}
function linkbookwithtransver(transverid){
	ajax("ajax=linkwithtransver&b="+bookinfo.id+"&h="+bookinfo.host+"&t="+transverid,function(d){
		ui.notif(d);
	});
}
function showchaptersearch(){
	
}
function showpushbook(){
	if(g("modal-pushbook")!=null){
		g("modal-pushbook").remove();
	}
	var md=createModal("Đẩy sách");
	md.body().innerHTML="<center><span class='spinner-border'></span></center>";
	md.setAttribute("id", "modal-pushbook");
	md.show();
	
	ajax("ajax=bookpush&sub=getpushinfo&booklid="+bookinfo.lid,function(d){
		md.body().innerHTML=d;
	});
}
function pushbook(btn){
	var channel = "";
	var point = q(".pushpointsel.btn-primary")[0].innerHTML;
	var chsl = g("selchannel");
	if(chsl.tagName=="SELECT"){
		channel = chsl.value;
	}else{
		channel = chsl.innerHTML;
	}
	ajax("ajax=bookpush&sub=pushbook&booklid="+bookinfo.lid+"&channel="+channel+"&point="+point,function(d){
		alert(d);
		if(d.contain("thêm")){
			if(g("modal-pushbook")!=null){
				g("modal-pushbook").hide();
			}
		}
	});
}
function changepps(btn){
	q(".pushpointsel").forEach(function(e){e.className = "pushpointsel btn btn-outline-primary"});
	btn.className="pushpointsel btn btn-primary";
}
function expandchapterlist(force){
	if(isexpanded){
		g("chaptercontainer").style.maxHeight="240px";
		if(g("clicktoexp")){
			var e = g("clicktoexp").querySelector(".span") || g("clicktoexp");
			e.innerHTML= localLang["Mở rộng"] + " <i class='fas fa-chevron-down'></i>";
			//g("clicktoexp").innerHTML= localLang["Mở rộng"] + " <i class='fas fa-chevron-down'></i>";
		}
		isexpanded=false;
		if(window.totopbtn){
			window.totopbtn.remove();
			window.totopbtn = null;
		}
	}else{
		g("chaptercontainer").style.maxHeight="none";//g("chaptercontainer").children[0].offsetHeight+24;
		if(g("clicktoexp")){
			var e = g("clicktoexp").querySelector(".span") || g("clicktoexp");
			e.innerHTML=localLang["Thu hẹp"] + " <i class='fas fa-chevron-up'></i>";
		}
		isexpanded=true;
		if(window.event && (event.type=="click" || force)){
			console.log(event);
			var lastchapreaded = q(".chaplastreaded")[0];
			if(lastchapreaded){
				$([document.documentElement, document.body]).animate({
					scrollTop: $(lastchapreaded).offset().top - 300
				}, 200);
			}
		}
		if(!window.totopbtn){
			try{
				window.totopbtn = ui.floatbtn("gotopchapterlist()","fa-arrow-up");
			}catch(e){}
			
		}
		
	}
}
function gotopchapterlist(){
	ui.scrollto("chapterlist",0);
}
function coverrepair(e){
	var def256 = "https://static.sangtacvietcdn.xyz/img/bookcover256.jpg";
	// g("thumb-lay").style.background = 'url(/?sajax=reportbookcover&b='+bookinfo.id+'&h='+bookinfo.host+')';
	// e.src='/?sajax=reportbookcover&b='+bookinfo.id+'&h='+bookinfo.host;
	g("thumb-lay").style.background = "url(" + def256 + ")";
	e.src = def256;
	e.onerror='';
}
function getlastread(){
	var ss=localStorage.getItem("tusach");
	if(ss==null){
		return 0;
	}else{
		var sss=ss.split("~/~");
		var rd=0;
		sss.forEach(function(e)
		{
			if(e!=""){
				try {
					var f=JSON.parse(e);
					if(f.host==bookinfo.host&&f.id==bookinfo.id){
						var curs=f.current.split("-,-");
						rd=parseBInt(curs[0]);
						console.log(rd);
						return;
					}
				} catch(e) {
				}
			}
		});
		return rd;
	}
}

function deleteBook(){
	if(!confirm("Xác nhận xóa truyện?")){
		return;
	}
	modact("act=deletebook&id="+bookinfo.id+"&host="+bookinfo.host,function(d){
		alert(d);
	});
}