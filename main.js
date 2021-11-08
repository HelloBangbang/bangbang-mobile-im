(function (window) {
    //兼容
    window.URL = window.URL || window.webkitURL;
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

    var HZRecorder = function (stream, config) {
        config = config || {};
        config.sampleBits = config.sampleBits || 16;      //采样数位 8, 16
        config.sampleRate = config.sampleRate || (16000);   //采样率(1/6 44100)

        var context = new (window.webkitAudioContext || window.AudioContext)();
        var audioInput = context.createMediaStreamSource(stream);
        var createScript = context.createScriptProcessor || context.createJavaScriptNode;
        var recorder = createScript.apply(context, [4096, 1, 1]);

        var audioData = {
            size: 0          //录音文件长度
            , buffer: []     //录音缓存
            , inputSampleRate: context.sampleRate    //输入采样率
            , inputSampleBits: 16       //输入采样数位 8, 16
            , outputSampleRate: config.sampleRate    //输出采样率
            , oututSampleBits: config.sampleBits       //输出采样数位 8, 16
            , input: function (data) {
                this.buffer.push(new Float32Array(data));
                this.size += data.length;
            }
            , compress: function () { //合并压缩
                //合并
                var data = new Float32Array(this.size);
                var offset = 0;
                for (var i = 0; i < this.buffer.length; i++) {
                    data.set(this.buffer[i], offset);
                    offset += this.buffer[i].length;
                }
                //压缩
                var compression = parseInt(this.inputSampleRate / this.outputSampleRate);
                var length = data.length / compression;
                var result = new Float32Array(length);
                var index = 0, j = 0;
                while (index < length) {
                    result[index] = data[j];
                    j += compression;
                    index++;
                }
                return result;
            }
            , encodeWAV: function () {
                var sampleRate = Math.min(this.inputSampleRate, this.outputSampleRate);
                var sampleBits = Math.min(this.inputSampleBits, this.oututSampleBits);
                var bytes = this.compress();
                var dataLength = bytes.length * (sampleBits / 8);
                var buffer = new ArrayBuffer(44 + dataLength);
                var data = new DataView(buffer);

                var channelCount = 1;//单声道
                var offset = 0;

                var writeString = function (str) {
                    for (var i = 0; i < str.length; i++) {
                        data.setUint8(offset + i, str.charCodeAt(i));
                    }
                }

                // 资源交换文件标识符 
                writeString('RIFF'); offset += 4;
                // 下个地址开始到文件尾总字节数,即文件大小-8 
                data.setUint32(offset, 36 + dataLength, true); offset += 4;
                // WAV文件标志
                writeString('WAVE'); offset += 4;
                // 波形格式标志 
                writeString('fmt '); offset += 4;
                // 过滤字节,一般为 0x10 = 16 
                data.setUint32(offset, 16, true); offset += 4;
                // 格式类别 (PCM形式采样数据) 
                data.setUint16(offset, 1, true); offset += 2;
                // 通道数 
                data.setUint16(offset, channelCount, true); offset += 2;
                // 采样率,每秒样本数,表示每个通道的播放速度 
                data.setUint32(offset, sampleRate, true); offset += 4;
                // 波形数据传输率 (每秒平均字节数) 单声道×每秒数据位数×每样本数据位/8 
                data.setUint32(offset, channelCount * sampleRate * (sampleBits / 8), true); offset += 4;
                // 快数据调整数 采样一次占用字节数 单声道×每样本的数据位数/8 
                data.setUint16(offset, channelCount * (sampleBits / 8), true); offset += 2;
                // 每样本数据位数 
                data.setUint16(offset, sampleBits, true); offset += 2;
                // 数据标识符 
                writeString('data'); offset += 4;
                // 采样数据总数,即数据总大小-44 
                data.setUint32(offset, dataLength, true); offset += 4;
                // 写入采样数据 
                if (sampleBits === 8) {
                    for (var i = 0; i < bytes.length; i++, offset++) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        var val = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        val = parseInt(255 / (65535 / (val + 32768)));
                        data.setInt8(offset, val, true);
                    }
                } else {
                    for (var i = 0; i < bytes.length; i++, offset += 2) {
                        var s = Math.max(-1, Math.min(1, bytes[i]));
                        data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
                }

                return new Blob([data], { type: 'audio/wav' });
            }
        };

        //开始录音
        this.start = function () {
            audioInput.connect(recorder);
            recorder.connect(context.destination);
        }

        //停止
        this.stop = function () {
            recorder.disconnect();
        }

        //获取音频文件
        this.getBlob = function () {
            this.stop();
            return audioData.encodeWAV();
        }

        //回放
        this.play = function (audio) {
            audio.src = window.URL.createObjectURL(this.getBlob());
        }

        //上传
        this.upload = function (url, callback) {
            var fd = new FormData();
            fd.append("audioData", this.getBlob());
            var xhr = new XMLHttpRequest();
            if (callback) {
                xhr.upload.addEventListener("progress", function (e) {
                    callback('uploading', e);
                }, false);
                xhr.addEventListener("load", function (e) {
                    callback('ok', e);
                }, false);
                xhr.addEventListener("error", function (e) {
                    callback('error', e);
                }, false);
                xhr.addEventListener("abort", function (e) {
                    callback('cancel', e);
                }, false);
            }
            xhr.open("POST", url);
            xhr.send(fd);
        }

        //音频采集
        recorder.onaudioprocess = function (e) {
            audioData.input(e.inputBuffer.getChannelData(0));
            //record(e.inputBuffer.getChannelData(0));
        }

    };
    //抛出异常
    HZRecorder.throwError = function (message) {
        msg.info(message);
        throw new function () { this.toString = function () { return message; } }
    }
    //是否支持录音
    HZRecorder.canRecording = (navigator.getUserMedia != null);
    //获取录音机
    HZRecorder.get = function (callback, config) {
        if (callback) {
            if (navigator.getUserMedia) {
                navigator.getUserMedia(
                    { audio: true } //只启用音频
                    , function (stream) {
                        var rec = new HZRecorder(stream, config);
                        callback(rec);
                    }
                    , function (error) {
                        switch (error.code || error.name) {
                            case 'PERMISSION_DENIED':
                            case 'PermissionDeniedError':
                                HZRecorder.throwError('用户拒绝提供信息。');
                                break;
                            case 'NOT_SUPPORTED_ERROR':
                            case 'NotSupportedError':
                                HZRecorder.throwError('浏览器不支持硬件设备。');
                                break;
                            case 'MANDATORY_UNSATISFIED_ERROR':
                            case 'MandatoryUnsatisfiedError':
                                HZRecorder.throwError('无法发现指定的硬件设备。');
                                break;
                            default:
                                HZRecorder.throwError('无法打开麦克风。异常信息:' + (error.code || error.name));
                                break;
                        }
                    });
            } else {
                HZRecorder.throwErr('当前浏览器不支持录音功能。'); return;
            }
        }
    }

    window.HZRecorder = HZRecorder;

})(window);

var wm = {
	token:{
		/**
		 * 获取token，也就是 session id。获取的字符串如 f26e7b71-90e2-4913-8eb4-b32a92e43c00
		 * 如果用户未登录，那么获取到的是  youke_uuid。 这个会设置成layim 的  mine.id
		 */
		get:function(){
			return localStorage.getItem('token');
		},
		/**
		 * 设置token，也就是session id
		 * 格式如 f26e7b71-90e2-4913-8eb4-b32a92e43c00
		 */
		set:function(t){
			localStorage.setItem('token',t);
		}
	},
	load:{
		/**
		 * 同步加载JS，加载过程中会阻塞，加载完毕后继续执行后面的。
		 * url: 要加载的js的url
		 */
		synchronizesLoadJs:function(url){
			var  xmlHttp = null;  
			if(window.ActiveXObject){//IE  
				try {  
					//IE6以及以后版本中可以使用  
					xmlHttp = new ActiveXObject("Msxml2.XMLHTTP");  
				} catch (e) {  
					//IE5.5以及以后版本可以使用  
					xmlHttp = new ActiveXObject("Microsoft.XMLHTTP");  
				}  
			}else if(window.XMLHttpRequest){  
				//Firefox，Opera 8.0+，Safari，Chrome  
				xmlHttp = new XMLHttpRequest();  
			}  
			//采用同步加载  
			xmlHttp.open("GET",url,false);  
			//发送同步请求，如果浏览器为Chrome或Opera，必须发布后才能运行，不然会报错  
			xmlHttp.send(null);  
			//4代表数据发送完毕  
			if( xmlHttp.readyState == 4 ){  
				//0为访问的本地，200到300代表访问服务器成功，304代表没做修改访问的是缓存  
				if((xmlHttp.status >= 200 && xmlHttp.status <300) || xmlHttp.status == 0 || xmlHttp.status == 304){  
					var myBody = document.getElementsByTagName("HTML")[0];  
					var myScript = document.createElement( "script" );  
					myScript.language = "javascript";  
					myScript.type = "text/javascript";  
					try{  
						//IE8以及以下不支持这种方式，需要通过text属性来设置  
						myScript.appendChild(document.createTextNode(xmlHttp.responseText));  
					}catch (ex){  
						myScript.text = xmlHttp.responseText;  
					}  
					myBody.appendChild(myScript);  
					return true;  
				}else{  
					return false;  
				}  
			}else{  
				return false;  
			}  
		},
		//加载css文件，通过css的url
		css: function(url){
			if(!url || url.length === 0){
				throw new Error('argument "url" is required !');
			}
			var head = document.getElementsByTagName('HTML')[0];
			var link = document.createElement('link');
			link.href = url;
			link.rel = 'stylesheet';
			link.type = 'text/css';
			head.appendChild(link);
		},
	},
	/**
	 * 网络请求，都是用此
	 * api 请求的api接口，可以传入如 api.login_token
	 * data 请求的数据，如 {"goodsid":"1"} 
	 * func 请求完成的回调，传入如 function(data){}
	 */
	post:function(api, data, func){
		if(typeof(request) == 'undefined'){
			var protocol = '';
			if(window.location.protocol == 'file:'){
				//是在本地运行的，那么request.js 的请求 url 要加上 http:
				protocol = 'http:';
			}
			this.load.synchronizesLoadJs(protocol+'//res.weiunity.com/request/request.js')
		}
		if(this.token.get() != null && this.token.get().length > 0){
			data['token'] = this.token.get();
		}
		var headers = {'content-type':'application/x-www-form-urlencoded'};
		request.send(api, data, func, 'post', true, headers, function(xhr){
			console.log('request api,  status : '+xhr.status);
		});
	},
	/**
	 * 获取网址的get参数。
	 * @param name get参数名
	 * @returns value
	 */
	getUrlParams:function(name){
	     var reg = new RegExp("(^|&)"+ name +"=([^&]*)(&|$)");
	     var r = window.location.search.substr(1).match(reg);
	     if(r!=null)return  unescape(r[2]); return null;
	},
	

	/** 
	 * 时间戳转化为年 月 日 时 分 秒 
	 * number: 传入时间戳 如 1587653254
	 * format：返回格式，如 'Y-M-D h:m:s'
	*/
	formatTime:function(number,format) {
		var formateArr  = ['Y','M','D','h','m','s'];
		var returnArr   = [];
		var date = new Date(number * 1000);
		returnArr.push(date.getFullYear());
		returnArr.push(this.formatNumber(date.getMonth() + 1));
		returnArr.push(this.formatNumber(date.getDate()));
		returnArr.push(this.formatNumber(date.getHours()));
		returnArr.push(this.formatNumber(date.getMinutes()));
		returnArr.push(this.formatNumber(date.getSeconds()));
		for (var i in returnArr){
			format = format.replace(formateArr[i], returnArr[i]);
		}
		return format;
	},
	//时间戳转时间的数据转化，此方法只是服务于 formatTime
	formatNumber:function(n) {
		n = n.toString()
		return n[1] ? n : '0' + n
	},
	//将 a_b1_c2 转化为驼峰命名方式 aB1C2
	lineToHump:function(name){
		return name.replace(/\_(\w)/g, function(all, letter){
			return letter.toUpperCase();
		});
	},
	//获取form标签内的所有数据。获取到的是json对象的形态。 需要jquery支持。
	getJsonObjectByForm:function(obj){
		var o = {};
	    var a = obj.serializeArray();
	    $.each(a, function() {
	        if (o[this.name] !== undefined) {
	            if (!o[this.name].push) {
	                o[this.name] = [o[this.name]];
	            }
	            o[this.name].push(this.value || '');
	        } else {
	            o[this.name] = this.value || '';
	        }
	        
	        try{
	        	if(this.name != null && this.name.length > 0){
		        	if(this.name.indexOf('_') > -1){
		            	//出现了下划线，那可能是驼峰命名，增加驼峰传参
		        		 o[wm.lineToHump(this.name)] = o[this.name];
		            }
		        }
	        }catch(e){
	        	console.log(e);
	        }
	    });
	    return o;
	},
	/**
	 * 自动填充form标签内的数据。 需要jquery支持。
	 * @param obj 传入如 $('#form') ,要自动填充哪个form中的数据，就传入哪个form
	 * @param data json对象的数据值，比如form中有个input，name是age， 而 data.age 也有正常的值，那么 这个input就会正常填充上data.age的值
	 */
	fillFormValues:function(obj, data){
		var a = obj.serializeArray();
		for(var i = 0; i<a.length; i++){
			var wm_fv_name = a[i].name;
			var wm_fv_value = data[a[i].name];
			if(wm_fv_value != null && typeof(wm_fv_value) != 'undefined'){
				//有值，那么赋予输入框值
				
				/***** 赋予值 ******/
				//获取当前输入框的形式，是input、text、select 的哪种
				var tag = document.getElementsByName(wm_fv_name)[0].nodeName.toLowerCase();
				
				//if(tag == 'input' || tag == 'select' || tag == 'text'){
					document.getElementsByName(wm_fv_name)[0].value = wm_fv_value;
				//}
				
				//判断当前输入是否是图片输入
				var form_uploadImage_titlePicA = document.getElementById(wm_fv_name+'_titlePicA');
				if(form_uploadImage_titlePicA != null){
					//不是null，那这项就是图片上传项了
					try{
						document.getElementById(wm_fv_name+"_titlePicA").href = wm_fv_value;
						document.getElementById(wm_fv_name+"_titlePicImg").src = wm_fv_value;
						document.getElementById(wm_fv_name+"_titlePicImg").style.display='';
					}catch(e){
						console.log(e);
					}
				}
				/***** 赋予值结束 ******/
			}
		}
		
		//重新渲染 layui 的form
		if(typeof(layui) != 'undefined'){
			layui.use(['form'], function(){
				var form = layui.form;
				form.render(); //更新全部
			});
		}
	}
};
var msg = {
    version: 1.3,
    errorIcon: '<svg style="width: 3rem; height:3rem; padding: 1.5rem; padding-bottom: 1.1rem; box-sizing: content-box;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6977"><path d="M696.832 326.656c-12.8-12.8-33.28-12.8-46.08 0L512 465.92 373.248 327.168c-12.8-12.8-33.28-12.8-46.08 0s-12.8 33.28 0 46.08L466.432 512l-139.264 139.264c-12.8 12.8-12.8 33.28 0 46.08s33.28 12.8 46.08 0L512 558.08l138.752 139.264c12.288 12.8 32.768 12.8 45.568 0.512l0.512-0.512c12.8-12.8 12.8-33.28 0-45.568L557.568 512l139.264-139.264c12.8-12.8 12.8-33.28 0-46.08 0 0.512 0 0 0 0zM512 51.2c-254.464 0-460.8 206.336-460.8 460.8s206.336 460.8 460.8 460.8 460.8-206.336 460.8-460.8-206.336-460.8-460.8-460.8z m280.064 740.864c-74.24 74.24-175.104 116.224-280.064 115.712-104.96 0-205.824-41.472-280.064-115.712S115.712 616.96 115.712 512s41.472-205.824 116.224-280.064C306.176 157.696 407.04 115.712 512 116.224c104.96 0 205.824 41.472 280.064 116.224 74.24 74.24 116.224 175.104 115.712 280.064 0.512 104.448-41.472 205.312-115.712 279.552z" fill="#ffffff" p-id="6978"></path></svg>',
    currentWindowsId: 0,
    success: function (i, t) {
        this.show(i, '<svg style="width: 3rem; height:3rem; padding: 1.5rem; padding-bottom: 1.1rem; box-sizing: content-box;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2351"><path d="M384 887.456L25.6 529.056 145.056 409.6 384 648.544 878.944 153.6 998.4 273.056z" p-id="2352" fill="#ffffff"></path></svg>'), this.delayClose(1500, t)
    },
    failure: function (i, t) {
        this.show(i, this.errorIcon), this.delayClose(2500, t)
    },
    info: function (i, t) {
        this.show(i, '<svg style="width: 3rem; height:3rem; padding: 1.5rem; padding-bottom: 1.1rem; box-sizing: content-box;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7996"><path d="M509.979 959.316c-247.308 0-447.794-200.486-447.794-447.794S262.671 63.728 509.979 63.728s447.794 200.486 447.794 447.794-200.485 447.794-447.794 447.794z m0-814.171c-202.346 0-366.377 164.031-366.377 366.377s164.031 366.377 366.377 366.377c202.342 0 366.377-164.031 366.377-366.377S712.321 145.145 509.979 145.145z m-40.708 610.628c-40.709 0-40.709-40.708-40.709-40.708l40.709-203.543s0-40.709-40.709-40.709c0 0-40.709 0-40.709-40.709h122.126s40.709 0 40.709 40.709-40.709 162.834-40.709 203.543 40.709 40.709 40.709 40.709h40.709c-0.001 0-0.001 40.708-122.126 40.708z m81.417-407.085c-22.483 0-40.709-18.225-40.709-40.709s18.225-40.709 40.709-40.709 40.709 18.225 40.709 40.709-18.226 40.709-40.709 40.709z" p-id="7997" fill="#ffffff"></path></svg>'), this.delayClose(2500, t)
    },
    confirm: function (i) {
        return confirm(i)
    },
    loading: function (i) {
        this.show(i, '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjRjlGOUY5Ij4KICA8Y2lyY2xlIGN4PSIxNiIgY3k9IjMiIHI9IjAiPgogICAgPGFuaW1hdGUgYXR0cmlidXRlTmFtZT0iciIgdmFsdWVzPSIwOzM7MDswIiBkdXI9IjFzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIgYmVnaW49IjAiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgogIDxjaXJjbGUgdHJhbnNmb3JtPSJyb3RhdGUoNDUgMTYgMTYpIiBjeD0iMTYiIGN5PSIzIiByPSIwIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDszOzA7MCIgZHVyPSIxcyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIGJlZ2luPSIwLjEyNXMiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgogIDxjaXJjbGUgdHJhbnNmb3JtPSJyb3RhdGUoOTAgMTYgMTYpIiBjeD0iMTYiIGN5PSIzIiByPSIwIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDszOzA7MCIgZHVyPSIxcyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIGJlZ2luPSIwLjI1cyIga2V5U3BsaW5lcz0iMC4yIDAuMiAwLjQgMC44OzAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjgiIGNhbGNNb2RlPSJzcGxpbmUiIC8+CiAgPC9jaXJjbGU+CiAgPGNpcmNsZSB0cmFuc2Zvcm09InJvdGF0ZSgxMzUgMTYgMTYpIiBjeD0iMTYiIGN5PSIzIiByPSIwIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDszOzA7MCIgZHVyPSIxcyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIGJlZ2luPSIwLjM3NXMiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgogIDxjaXJjbGUgdHJhbnNmb3JtPSJyb3RhdGUoMTgwIDE2IDE2KSIgY3g9IjE2IiBjeT0iMyIgcj0iMCI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJyIiB2YWx1ZXM9IjA7MzswOzAiIGR1cj0iMXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIiBiZWdpbj0iMC41cyIga2V5U3BsaW5lcz0iMC4yIDAuMiAwLjQgMC44OzAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjgiIGNhbGNNb2RlPSJzcGxpbmUiIC8+CiAgPC9jaXJjbGU+CiAgPGNpcmNsZSB0cmFuc2Zvcm09InJvdGF0ZSgyMjUgMTYgMTYpIiBjeD0iMTYiIGN5PSIzIiByPSIwIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9InIiIHZhbHVlcz0iMDszOzA7MCIgZHVyPSIxcyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIGJlZ2luPSIwLjYyNXMiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgogIDxjaXJjbGUgdHJhbnNmb3JtPSJyb3RhdGUoMjcwIDE2IDE2KSIgY3g9IjE2IiBjeT0iMyIgcj0iMCI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJyIiB2YWx1ZXM9IjA7MzswOzAiIGR1cj0iMXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIiBiZWdpbj0iMC43NXMiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgogIDxjaXJjbGUgdHJhbnNmb3JtPSJyb3RhdGUoMzE1IDE2IDE2KSIgY3g9IjE2IiBjeT0iMyIgcj0iMCI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJyIiB2YWx1ZXM9IjA7MzswOzAiIGR1cj0iMXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIiBiZWdpbj0iMC44NzVzIiBrZXlTcGxpbmVzPSIwLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44OzAuMiAwLjIgMC40IDAuOCIgY2FsY01vZGU9InNwbGluZSIgLz4KICA8L2NpcmNsZT4KICA8Y2lyY2xlIHRyYW5zZm9ybT0icm90YXRlKDE4MCAxNiAxNikiIGN4PSIxNiIgY3k9IjMiIHI9IjAiPgogICAgPGFuaW1hdGUgYXR0cmlidXRlTmFtZT0iciIgdmFsdWVzPSIwOzM7MDswIiBkdXI9IjFzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIgYmVnaW49IjAuNXMiIGtleVNwbGluZXM9IjAuMiAwLjIgMC40IDAuODswLjIgMC4yIDAuNCAwLjg7MC4yIDAuMiAwLjQgMC44IiBjYWxjTW9kZT0ic3BsaW5lIiAvPgogIDwvY2lyY2xlPgo8L3N2Zz4K" style="width: 3rem; height:3rem; padding: 1.5rem; padding-bottom: 1.1rem; box-sizing: content-box;" />')
    },
    close: function () {
        this.currentWindowsId = 0;
        var i = document.getElementById("wangmarket_loading");
        if (null != i) {
            var t = i.parentNode;
            null != t && t.removeChild(i)
        }
        var e = document.getElementById("wangmarket_popups");
        if (null != e) {
            var l = e.parentNode;
            null != l && l.removeChild(e)
        }
    },
    delayClose: function (i, t) {
        var e = parseInt(1e5 * Math.random());
        this.currentWindowsId = e;
        var l = this;
        setTimeout(function () {
            l.currentWindowsId == e && l.close(), null != t && t()
        }, i)
    },
    show: function (i, t) {
        var e = !1;
        if (null != i && i.length > 10 && (e = !0), this.close(), null != document.getElementsByTagName("body") && document.getElementsByTagName("body").length > 0) {
            var l = document.createElement("div");
            l.id = "wangmarket_loading", l.style = "position: fixed;z-index: 2147483647;margin: 0 auto;text-align: center;width: 100%;", l.innerHTML = '<div id="loading" style="position: fixed;top: 30%;text-align: center;font-size: 1rem;color: #dedede;margin: 0px auto;left: 50%;margin-left: -' + (e ? "9" : "3.5") + 'rem;"><div style="width: 7rem;background-color: #2e2d3c;border-radius: 0.3rem; filter: alpha(Opacity=80); -moz-opacity: 0.8; opacity: 0.8; min-height: 4.8rem;' + (e ? "width: 18rem;" : "") + '"><div' + (e ? ' style="float:left;height: 20rem; margin-top: -0.6rem; position: fixed;"' : "") + ">" + t + '</div><div style="width: 100%;padding-bottom: 1.4rem; font-size: 1.1rem; padding-left: 0.3rem;padding-right: 0.3rem; box-sizing: border-box;line-height: 1.2rem;color: white;' + (e ? "padding: 1rem; text-align: left; padding-right: 0.3rem; line-height: 1.5rem;margin-left: 4.8rem; padding-right: 5.5rem; padding-top: 0.7rem;" : "") + '">' + i + "</div></div>", document.getElementsByTagName("body")[0].appendChild(l)
        } else alert("提示，body中没有子元素，无法显示 msg.js 的提示")
    },
    popups: function (i) {
        var t = !1,
            e = !1;
        void 0 === i ? i = {} : "string" == typeof i && (i = {
            text: i
        }), null == i && (i = {}), null != i.left && (t = !0), null == i.top && null == i.bottom || (e = !0), null != i.url && (null != i.text && console.log("友好提醒：您已经设置了 attribute.url ，但是您又设置了 attribute.text ，根据优先级， 将采用 attribute.url ，而 attribute.text 设置无效。 "), i.text = '<iframe src="' + i.url + '" frameborder="0" style="width:100%;height:100%; display:none;" onload="document.getElementById(\'msg_popups_loading\').style.display=\'none\'; this.style.display=\'\';"></iframe><div id="msg_popups_loading" style="width: 100%; height: 100%; text-align: center; padding-top: 30%; font-size: 1.4rem; box-sizing: border-box; overflow: hidden; ">加载中...</div>'), null == i.text && (i.text = "您未设置text的值，所以这里出现提醒文字。您可以这样用: <pre>msg.popups('我是提示文字');</pre>"), null != i.height && null != i.bottom && console.log("msg.js -- function popups() : 友情提示:您同时设置了height、bottom两个属性，此时height属性生效，bottom属性将会不起作用"), null == i.close && (i.close = !0), null == i.top && (i.top = "auto"), (null == i.bottom || i.bottom.length < 1) && (i.bottom = "auto"), null == i.background && (i.background = "#2e2d3c"), null == i.opacity && (i.opacity = 92), null == i.height && (i.height = "auto"), null == i.left && (i.left = "5%"), null == i.width && (i.width = "90%"), null == i.padding && (i.padding = "1rem");
        var l = document.createElement("div");
        if (l.id = "wangmarket_popups", l.style = "position: fixed; z-index: 2147483647; margin: 0px auto; text-align: center; width: 100%; ", l.innerHTML = '<div style="position: fixed; top:' + i.top + "; bottom:" + i.bottom + "; text-align: center;font-size: 1rem;color: #dedede;margin: 0px auto;width: " + i.width + ";left: " + i.left + "; height: " + i.height + ';"><div style="padding:0rem"><div style="width: 100%;background-color: ' + i.background + ";border-radius: 0.3rem;filter: alpha(Opacity=" + i.opacity + ");-moz-opacity: " + i.opacity / 100 + ";opacity: " + i.opacity / 100 + ';min-height: 4.8rem; height: 100%;"><div style=" width: 100%; font-size: 1rem; box-sizing: border-box; line-height: 1.3rem; color: white; text-align: left; padding: ' + i.padding + "; overflow-y: auto; height: " + i.height + '; display: flex; border-radius: 0.4rem;">' + i.text + "</div>" + (i.close ? '<div class="msg_close" style="top: -0.8rem;position: absolute;right: -0.6rem;background-color: aliceblue;border-radius: 50%;height: 2rem;width: 2rem;" onclick="msg.close();"><svg style="width: 2rem; height:2rem; cursor: pointer;" t="1601801323865" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4482" width="48" height="48"><path d="M512.001 15.678C237.414 15.678 14.82 238.273 14.82 512.86S237.414 1010.04 512 1010.04s497.18-222.593 497.18-497.18S786.589 15.678 512.002 15.678z m213.211 645.937c17.798 17.803 17.798 46.657 0 64.456-17.798 17.797-46.658 17.797-64.456 0L512.001 577.315 363.241 726.07c-17.799 17.797-46.652 17.797-64.45 0-17.804-17.799-17.804-46.653 0-64.456L447.545 512.86 298.79 364.104c-17.803-17.798-17.803-46.657 0-64.455 17.799-17.798 46.652-17.798 64.45 0l148.761 148.755 148.755-148.755c17.798-17.798 46.658-17.798 64.456 0 17.798 17.798 17.798 46.657 0 64.455L576.456 512.86l148.756 148.755z m0 0" fill="' + i.background + '" p-id="4483"></path></svg></div>' : "") + "</div></div></div>", null != document.getElementsByTagName("body") && document.getElementsByTagName("body").length > 0) {
            document.getElementsByTagName("body")[0].appendChild(l);
            var o = document.getElementById("wangmarket_popups").firstChild;
            if (!t) try {
                var n = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
                    g = o.clientWidth || o.offsetWidth;
                o.style.left = (n - g) / 2 + "px"
            } catch (i) {
                console.log(i)
            }
            if (!e) try {
                var d = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight,
                    I = o.clientHeight || o.offsetHeight;
                o.style.top = I > d ? "20px" : (d - I) / 2 + "px"
            } catch (i) {
                console.log(i)
            }
        } else alert("提示，body中没有子元素，无法显示 msg.js 的提示")
    },
    confirm: function (i, t) {
        if ("string" == typeof i && ((i = {
                text: i
            }).buttons = {
                "确定": t,
                "取消": function () {}
            }), null == i.buttonStyle && (i.buttonStyle = "padding-left:0.6rem; padding-right:0.6rem; font-size: 0.9rem;"), null == i.text) i.text = "您未设置text的值，所以这里出现提醒文字。您可以这样用: <pre>msg.popups('我是提示文字');</pre>";
        else {
            null == i.buttons && (i.text = "您还未设置 buttons 属性");
            var e = 0;
            for (let t in i.buttons) e++;
            var l = "";
            for (let t in i.buttons) {
                e--;
                var o = t + "_" + (new Date).getTime();
                window.msg.confirm[o] = function () {
                    msg.close(), i.buttons[t]()
                }, l = l + "<button onclick=\"window.msg.confirm['" + o + '\']();" style="' + i.buttonStyle + '">' + t + "</button>" + (e > 0 ? "&nbsp;&nbsp;" : "")
            }
            i.text = '<div style="line-height: 1.4rem; width:100%; padding-right: 0.2rem;">' + i.text + '<div style=" display: inherit; width: 100%; text-align: right;margin-top: 1rem;">' + l + "</div></div>"
        }
        null == i.close && (i.close = !1), null == i.width && (i.width = "17rem"), msg.popups(i)
    },
    alert: function (i) {
        msg.confirm({
            text: i,
            buttons: {
                "确定": function () {}
            }
        })
    }
};

/* 生成一个随机UUID */
function generateUUID() {
    var d = new Date().getTime();
    if (window.performance && typeof window.performance.now === "function") {
        d += performance.now(); //use high-precision timer if available
    }
    var uuid = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return uuid;
}

/**
 * 获取网址的get参数。
 * @param name get参数名
 * @returns value
 */
function getUrlParams(name){
     var reg = new RegExp("(^|&)"+ name +"=([^&]*)(&|$)");
     var r = window.location.search.substr(1).match(reg);
     if(r!=null)return  unescape(r[2]); return null;
}

//时间戳转时间的数据转化
function formatNumber(n) {
  n = n.toString();
  return n[1] ? n : '0' + n;
}
/** 
 * 时间戳转化为年 月 日 时 分 秒 
 * number: 传入时间戳 如 1587653254
 * format：返回格式，如 'Y-M-D h:m:s'
*/
function formatTime(number,format) {
	var formateArr  = ['Y','M','D','h','m','s'];
	var returnArr   = [];
	if((number + '').length == 10){
		number = number * 1000;
  	}
	var date = new Date(number);
  returnArr.push(date.getFullYear());
  returnArr.push(formatNumber(date.getMonth() + 1));
  returnArr.push(formatNumber(date.getDate()));
  returnArr.push(formatNumber(date.getHours()));
  returnArr.push(formatNumber(date.getMinutes()));
  returnArr.push(formatNumber(date.getSeconds()));
  for (var i in returnArr){
    format = format.replace(formateArr[i], returnArr[i]);
  }
  return format;
}

/**
 * ajax请求 不依赖任何框架及其他文件
 * 作者：管雷鸣
 * 个人网站：www.guanleiming.com
 * 个人微信: xnx3com
 * 公司：潍坊雷鸣云网络科技有限公司
 * 公司官网：www.leimingyun.com
 */
var request = {
	/**
	 * get请求
	 * @param url 请求的接口URL，传入如 http://www.xxx.com/a.php
	 * @param data 请求的参数数据，传入如 {"goodsid":"1", "author":"管雷鸣"}
	 * @param func 请求完成的回调，传入如 function(data){ console.log(data); }
	 */
	get:function(url, data, func){
		var headers = {
			'content-type':'application/x-www-form-urlencoded'
		};
		this.send(url, data, func, 'get', true, headers, null);
	},
	/**
	 * post请求
	 * @param url 请求的接口URL，传入如 http://www.xxx.com/a.php
	 * @param data 请求的参数数据，传入如 {"goodsid":"1", "author":"管雷鸣"}
	 * @param func 请求完成的回调，传入如 function(data){ console.log(data); }
	 */
	post:function(url, data, func){
		var headers = {
			'content-type':'application/x-www-form-urlencoded'
		};
		this.send(url, data, func, 'POST', true, headers, null);
	},
	/**
	 * 发送请求
	 * url 请求的url
	 * data 请求的数据，如 {"author":"管雷鸣",'site':'www.guanleiming.com'} 
	 * func 请求完成的回调，传入如 function(data){}
	 * method 请求方式，可传入 post、get
	 * isAsynchronize 是否是异步请求， 传入 true 是异步请求，传入false 是同步请求
	 * headers 设置请求的header，传入如 {'content-type':'application/x-www-form-urlencoded'};
	 * abnormalFunc 响应异常所执行的方法，响应码不是200就会执行这个方法 ,传入如 function(xhr){}
	 */
	send:function(url, data, func, method, isAsynchronize, headers, abnormalFunc){
		//post提交的参数
		var params = '';
		if(data != null){
			for(var index in data){
				if(params.length > 0){
					params = params + '&';
				}
				params = params + index + '=' + data[index];
			}
		}
		
		var xhr=null;
		try{
			xhr=new XMLHttpRequest();
		}catch(e){
			xhr=new ActiveXObject("Microsoft.XMLHTTP");
		}
		//2.调用open方法（true----异步）
		xhr.open(method,url,isAsynchronize);
		//设置headers
		if(headers != null){
			for(var index in headers){
				xhr.setRequestHeader(index,headers[index]);
			}
		}
		xhr.send(params);
		//4.请求状态改变事件
		xhr.onreadystatechange=function(){
		    if(xhr.readyState==4){
		        if(xhr.status==200){
		        	//请求正常，响应码 200
		        	var json = null;
		        	try{
		        		json = JSON.parse(xhr.responseText);
		        	}catch(e){
		        		console.log(e);
		        	}
		        	if(json == null){
		        		func(xhr.responseText);
		        	}else{
		        		func(json);
		        	}
		        }else{
		        	if(abnormalFunc != null){
		        		abnormalFunc(xhr);
		        	}
		        }
		    }
		}
	},

	/**
	 * 文件上传
	 * url 请求的url
	 * data 请求的数据，如 {"author":"管雷鸣",'site':'www.guanleiming.com'} 
	 * file 要上传的文件。可以通过input的 e.srcElement.files[0] 获取
	 * successFunc 请求成功的回调，响应码是200就会执行这个。传入如 function(data){}
	 * headers 设置请求的header，传入如 {'content-type':'application/x-www-form-urlencoded'};
	 * abnormalFunc 响应异常所执行的方法，响应码不是200就会执行这个方法 ,传入如 function(xhr){}
	 */
	upload:function(url,data, file, successFunc, headers, abnormalFunc){
		//post提交的参数
		var fd = new FormData();
		fd.append('file', file);
		if(data != null){
			for(var index in data){
				fd.append(index, data[index]);
			}
		}
		
		var xhr=null;
		try{
			xhr=new XMLHttpRequest();
		}catch(e){
			xhr=new ActiveXObject("Microsoft.XMLHTTP");
		}
		//2.调用open方法（true----异步）
		xhr.open('POST',url,true);
		//设置headers
		if(headers != null){
			for(var index in headers){
				xhr.setRequestHeader(index,headers[index]);
			}
		}
		xhr.send(fd);
		//4.请求状态改变事件
		xhr.onreadystatechange=function(){
		    if(xhr.readyState==4){
		        if(xhr.status==200){
		        	//请求正常，响应码 200
		        	var json = null;
		        	try{
		        		json = JSON.parse(xhr.responseText);
		        	}catch(e){
		        		console.log(e);
		        	}
		        	if(json == null){
		        		successFunc(xhr.responseText);
		        	}else{
		        		successFunc(json);
		        	}
		        }else{
		        	if(abnormalFunc != null){
		        		abnormalFunc(xhr);
		        	}
		        }
		    }
		}
	}

}

var kefu = {
	version:1.1, 	//当前kefu.js的版本
	api:{
		domain:'https://api.kefu.leimingyun.com/',				//domain域名，设置如 https://xxxxxxx.com/   前面要带协议 ，后面要带 /
		getMyUser:'/kefu/chat/user/init.json',			//获取当前用户，我自己的用户信息。传入如 http://xxxx.com/user/getMyUser.json
		getChatOtherUser:'/kefu/chat/zuoxi/getUserByZuoxiId.json',	//获取chat一对一聊天窗口中，当前跟我沟通的对方的用户信息。传入如 http://xxxx.com/user/getUserById.json 会自动携带当前登录用户的token、以及对方的userid
		getChatOtherUserByKefuChatid:'/kefu/chat/zuoxi/getUserByKefuChatId.json',	//通过kefu.chatid 来让客服后台自动分配一个当前在线的、且闲置的客服给用户。
		chatLog:'/kefu/chat/log/log.json',				//获取我跟某人的历史聊天记录列表的接口
		uploadImage:'/kefu/chat/file/uploadImage.json',			//图片上传接口
		uploadAudio:'/kefu/chat/file/uploadAudio.json',		//语音（录音）上传接口
		uploadFile:'/kefu/chat/file/uploadFile.json',		//文件上传接口
		//传入如  kefu.api.uploadImage ,返回请求的绝对路径。有时候用户只是设置了 domain，其他的接口都是用默认的，用这个获取，会自动拼接domain、path
		get:function(path){
			//判断是否是带有绝对路径的，如果是，直接原样返回
			if(path.indexOf('//') == 0 || path.indexOf('https://') == 0 || path.indexOf('http://') == 0){
				return path;
			}
			
			//没带有绝对路径，那么判断是否是为空，如果为空，那么也直接返回空
			if(path == null || kefu.api.domain.length < 1){
				return '';
			}
			
			//剩下一种可能就是相对路径了，进行domain组合
			return kefu.api.domain + path;
		}
	},
	user:{},	//当前用户信息，如： {"id":"youke_c302af1bb55de708a99fbc7266ddf016","nickname":"游客302a","head":"https://res.hc-cdn.com/cnpm-common-resource/2.0.2/base/header/components/images/logo.png","type":"youke"}
	currentPage:'list',	//当前所在哪个页面， 有 list 、 chat。 默认是list
	mode:'mobile',	//pc、mobile  两种模式。 pc模式是左侧是list、右侧是chat，  mobile是一栏要么是list要么是chat。  默认是mobile模式
	//初始化，当kefu.js 加载完毕后，可以执行这个，进行im的初始化
	init:function(){
		var head0 = document.getElementsByTagName('head')[0];

		//设置底部的输入方式切换
		if(document.getElementById('shuruType') != null){
			//先设置输入方式是more，然后切换一次，切换回键盘输入
			kefu.chat.shuruType = 'more';
			kefu.chat.shuruTypeChange();
		}
		for(var key in kefu.extend){
			//加载模块的js
			if(kefu.extend[key].js != null && kefu.extend[key].js.length > 0){
				console.log('script')
				var script = document.createElement("script");  //创建一个script标签
				script.type = "text/javascript";
				script.src = kefu.extend[key].js;
				head0.appendChild(script);
			}

			//加载模块的css
			if(kefu.extend[key].css != null && kefu.extend[key].css.length > 0){
				console.log('link')
				var link = document.createElement('link');
				link.type='text/css';
				link.rel = 'stylesheet';
				link.href = kefu.extend[key].css;
				head0.appendChild(link);
			}
			
			//如果模块有初始化，那么执行其初始化 init() 方法的代码
			if(kefu.extend[key].init != null){
				console.log('init')
				try{
					//避免某个模块中的初始化失败，导致整个im 初始化中断
					kefu.extend[key].init();
				}catch(e){ console.log(e); }
			}
		
		}
		 
		// //下载音频文件
		// kefu.notification.audio.load();
		
		// //获取聊天对方的用户信息
		// kefu.getMyUser(function(data){
		// 	kefu.user = data.user;
		// 	kefu.user.otherUserId = data.otherUserId;
		// 	kefu.socket.connect(kefu.socket.url);	//建立 socket 通讯
		// });
	},
	//新消息通知、提醒
	notification:{
		use:true,	//是否使用通知，默认为true，使用。如果不使用，那么就是false，false不再播放声音通知、桌面通知
		audioPath:'https://res.weiunity.com/kefu/media/voice.mp3',	//播放的音频文件路径，
		//播放提醒，执行提醒
		execute:function(title,text){
			if(!kefu.notification.use){
				//不使用
				return;
			}
			
			//播放声音
			try{
				kefu.notification.audio.play();
			}catch(e){
				console.log(e);
			}
			
			if(document.location.protocol != 'https:'){
				console.log('当前使用的不是https请求！只有https请求才可以有浏览器消息通知。这里只是声音通知');
				return;
			}
			
			//是https，那么支持Notification通知，使用通知提醒
			if (window.Notification != null){
				//支持通知
				
				if(Notification.permission === 'granted'){
					var notification = new Notification(title, {
						body: text,
						silent: false	//不播放声音。播放声音交给 kefu.notification.audio.play
						//sound:kefu.notification.audioPath
						//icon: 'https://res.weiunity.com/kefu/images/head.png'
					});
				}else {
					//未授权，弹出授权提示
					Notification.requestPermission();
				};
			}
		},
		audio:{
			audioBuffer:null,	//声音文件的音频流，通过url加载远程的音频流
			audioContext : new (window.AudioContext || window.webkitAudioContext || window.mozAudioContext || window.msAudioContext),
			//初始化预加载，将加载远程的mp3文件下载下来。这项应该在socket建立完链接之后在进行下载，不然会提前占用网速，导致socket建立连接过慢
			load:function(){
				if(kefu.notification.audioPath == null || kefu.notification.audioPath.length < 1){
					console.log('已将 kefu.notification.audioPath 设为空，将不再出现声音提醒');
					return;
				}
				var xhr = new XMLHttpRequest(); //通过XHR下载音频文件
		        xhr.open('GET', kefu.notification.audioPath, true);
		        xhr.responseType = 'arraybuffer';
		        xhr.onload = function (e) { //下载完成
		        	kefu.notification.audio.audioContext.decodeAudioData(this.response, function (buffer) { //解码成功时的回调函数
		        		kefu.notification.audio.audioBuffer = buffer;
		        	}, function (e) { //解码出错时的回调函数
		        		console.log('kefu.notification.load() Error decoding file', e);
		        	});
		        };
		        xhr.send();
			},
			//进行播放声音
			play:function(){
				if(kefu.notification.audio.audioBuffer == null){
					//网络加载音频文件。就不判断是否正在加载中了，多加载几次也无所谓了
					kefu.notification.audio.load();
					return; 
				}
				var audioSource = kefu.notification.audio.audioContext.createBufferSource();
				audioSource.buffer = kefu.notification.audio.audioBuffer;
				audioSource.connect(kefu.notification.audio.audioContext.destination);
				audioSource.start(0); //立即播放
			}
		}
	},
	//存储，比如存储聊天记录、用户信息等。都是以key、value方式存储。其中value是string字符串类型。可重写，自定义自己的存储方式
	storage:{
		get:function(key){
			return localStorage.getItem(key);
		},
		set:function(key, value){
			localStorage.setItem(key,value);
		}
	},
	token:{
		/* 如果用户已登录，这里存储的是用户的session，如果用户未登录，这里存储的是生成的 "youke+uuid" */
		token:null,
		/**
		 * 获取token，也就是 session id。获取的字符串如 f26e7b71-90e2-4913-8eb4-b32a92e43c00
		 * 如果用户未登录，那么获取到的是  youke_uuid。 这个会设置成layim 的  mine.id
		 */
		get:function(){
			if(this.token == null){
				this.token = kefu.storage.get('token');
			}
			if(this.token == null || this.token.length < 5){
				this.token = 'youke_'+generateUUID();
			}
			this.set(this.token);
			return this.token;
		},
		/**
		 * 设置token，也就是session id
		 * 格式如 f26e7b71-90e2-4913-8eb4-b32a92e43c00
		 */
		set:function(t){
			this.token = t;
			kefu.storage.set('token',this.token);
		}
	},
	/**
	 * 获取当前用户(我)的User信息
	 */
	getMyUser:function(func){
		if(kefu.api.getMyUser == null || kefu.api.getMyUser.length < 1){
			msg.popups('请设置 kefu.api.getMyUser 接口，用于获取当前用户(我)的信息');
			return;
		}
		request.post(kefu.api.get(kefu.api.getMyUser),{token:kefu.token.get()}, function(data){
			kefu.user = data.user;
			if(typeof(func) == 'function'){
				func(data);
			}
		});
	},
	//过滤html标签，防XSS攻击
	filterXSS:function (text) {
		if(text == null){
			return null;
		}
		text = text.replace(/<\/?[^>]*>/g, ''); //去除HTML Tag
		text = text.replace(/[|]*\n/, '') //去除行尾空格
		text = text.replace(/&npsp;/ig, ''); //去掉npsp
		return text;
	},
	//获取图片的url，正常使用时图片路径可能是 //cdn.xxxx.com/a.jpg ，但是在本地测试时，就会自动加上 file: 导致图片破裂了。这个方法作用就是自动补上协议，如果是本地，那就补上http协议，让图片能正常显示
	getImageUrl:function(imgUrl){
		if(typeof(imgUrl) == 'undefined'){
			return '';
		}
		
		if(imgUrl.indexOf('http://') == 0 || imgUrl.indexOf('https://') == 0){
			//如果图片路径是正常带有协议的，那么直接原样返回
			return imgUrl;
		}
		
		//判断一下是否是以 // 开头的，如果不是，那么也是原样返回
		if(imgUrl.indexOf('//') != 0){
			return imgUrl;
		}
		
		//如果是自动补齐协议，那么就要判断一下是否是本地使用了
		if(window.location.protocol == 'file:'){
			//本地使用，那图片默认补上 http 协议
			return 'http:'+imgUrl;
		}
		
		//其他情况，直接原样返回
		return imgUrl;
	},
	//将[ul][li][br]等转化为html
	ubb:function(text){
		if(text == null || typeof(text) == 'undefined'){
			return '';
		}
		
		return text.replace(/\[ul\]/g, '<ul>')
			.replace(/\[\/ul\]/g, '</ul>')
			.replace(/\[li\]/g, '<li onclick="kefu.chat.question(this);" class="question">')
			.replace(/\[\/li\]/g, '</li>')
			.replace(/\[br\]/g, '<br>');
	},
	//客户端方面的，如判断是手机还是电脑
	client:{
		//判断当前是手机（包括平板）还是电脑访问。是手机访问，则返回true，否则返回false
		isMobile:function(){
			if ((navigator.userAgent.match(/(iPhone|iPod|Android|ios|iOS|iPad|Backerry|WebOS|Symbian|Windows Phone|Phone)/i))) {
		        return true;
		    }else{
		        return false;
		    }
		}
	},
	//获取接收到的消息的text内容。 msg:socket传过来的消息，会把这个消息进行处理，返回最终显示给用户看的消息体
	getReceiveMessageText:function(message){
		if(message.extend != null && message.extend.name != null){
			//如果是插件，判断 text 数据是否有数据，也就是text已经被赋予过了 
			if(message['text'] != null && message['text'].length < 0){
				//已经赋予过了，不需要再执行插件的 format方法
			}else{
				//将json变为插件显示的样式
				if(typeof(kefu.extend[message.extend.name]) != 'undefined' && typeof(kefu.extend[message.extend.name].format) == 'function'){
					//如果实现了 format 方法，则执行其
					message = kefu.extend[message.extend.name].format(message);
				}
			}
		}
		//将[ul][li][br]等转化为html
		message['text'] = kefu.ubb(message['text']);
		return message['text'];
	},
	//UI界面方面
	ui:{
		//颜色相关控制
		color:{
			// 默认蓝色， 键盘、鼠标、发送按钮
			shuruTypeColor:'#1296db',
			extendIconColor:'#808080',	//插件图标的颜色，在chat底部显示的插件图标。 16进制颜色编码
		},
		//图片
		images:{
			//chat底部的更多，chat底部的输入方式切换
			more:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1603880506122" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7418" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M512.512 112.384c-219.6992 0-398.4896 178.7392-398.4896 398.4896 0 219.6992 178.7392 398.4896 398.4896 398.4896 219.6992 0 398.4896-178.7392 398.4896-398.4896s-178.7392-398.4896-398.4896-398.4896z m167.8848 424.0384H538.112v142.2848c0 14.1312-11.4688 25.6-25.6 25.6s-25.6-11.4688-25.6-25.6v-142.2848H344.6784c-14.1312 0-25.6-11.4688-25.6-25.6s11.4688-25.6 25.6-25.6H486.912V342.9888c0-14.1312 11.4688-25.6 25.6-25.6s25.6 11.4688 25.6 25.6v142.2848h142.2848c14.1312 0 25.6 11.4688 25.6 25.6s-11.4688 25.5488-25.6 25.5488z" fill="{color}" p-id="7419"></path></svg>',
			//键盘输入，chat底部的输入方式切换
			jianpan:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1603880701592" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10768" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M513.788813 938.289925c-113.566274 0-220.223734-44.167967-300.444149-124.388381-80.220415-80.220415-124.388382-186.877876-124.388382-300.44415s44.167967-220.227983 124.388382-300.448398c165.543834-165.548083 435.348714-165.548083 600.892548 0 165.548083 165.548083 165.548083 435.348714 0 600.892548-80.220415 80.220415-186.877876 124.388382-300.44415 124.388381z m0-785.973112c-92.538158 0-185.072066 35.453344-255.379651 105.756681-68.2001 68.204349-105.75668 158.63927-105.756681 255.3839s37.556581 187.175303 105.756681 255.379652c68.204349 68.2001 158.936697 106.054108 255.379651 105.75668 96.74888 0 187.179552-37.556581 255.379652-105.75668 140.912598-140.912598 140.912598-369.850954 0-510.759303-70.303336-70.307585-162.841494-105.75668-255.379652-105.756681z" p-id="10769" fill="{color}"></path><path d="M318.672199 341.705826h46.313693c11.047303 0 19.545228 8.497925 19.545228 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332h-46.738589c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695436v-46.738589c0-10.622407 8.497925-19.120332 19.120332-19.120332zM488.630705 341.705826h46.313693c11.047303 0 19.545228 8.497925 19.545229 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332h-46.73859c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695436v-46.738589c0-10.622407 8.497925-19.120332 19.120332-19.120332zM658.589212 341.705826h46.313693c11.047303 0 19.545228 8.497925 19.545228 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332h-46.738589c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695436v-46.738589c0-10.622407 8.497925-19.120332 19.120332-19.120332zM318.672199 469.174705h46.313693c10.622407 0 19.120332 8.497925 19.120332 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332H318.672199c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695435v-46.73859c0-10.622407 8.497925-19.120332 19.120332-19.120332zM488.630705 469.174705h46.313693c10.622407 0 19.120332 8.497925 19.120332 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332h-46.313693c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695435v-46.73859c0-10.622407 8.497925-19.120332 19.120332-19.120332zM658.589212 469.174705h46.313693c10.622407 0 19.120332 8.497925 19.120332 19.120332v46.313693c0 10.622407-8.497925 19.120332-19.120332 19.120332h-46.313693c-10.622407 0.424896-19.120332-8.073029-19.120332-18.695435v-46.73859c0-10.622407 8.497925-19.120332 19.120332-19.120332zM458.887967 660.378025h106.224066c17.420747 0 31.86722 14.446473 31.86722 31.86722s-14.446473 31.86722-31.86722 31.86722h-106.224066c-17.420747 0-31.86722-14.446473-31.86722-31.86722s14.446473-31.86722 31.86722-31.86722z" p-id="10770" fill="{color}"></path></svg>',
			//叉号，错误符号
			close:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1604403666528" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1160" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M583.168 523.776L958.464 148.48c18.944-18.944 18.944-50.176 0-69.12l-2.048-2.048c-18.944-18.944-50.176-18.944-69.12 0L512 453.12 136.704 77.312c-18.944-18.944-50.176-18.944-69.12 0l-2.048 2.048c-19.456 18.944-19.456 50.176 0 69.12l375.296 375.296L65.536 899.072c-18.944 18.944-18.944 50.176 0 69.12l2.048 2.048c18.944 18.944 50.176 18.944 69.12 0L512 594.944 887.296 970.24c18.944 18.944 50.176 18.944 69.12 0l2.048-2.048c18.944-18.944 18.944-50.176 0-69.12L583.168 523.776z" p-id="1161" fill="{color}"></path></svg>',
		},
		
		chat:{
			renderAreaId:'',		//渲染区域的id，如果不赋值，那么默认就是渲染到body
			html:`
				<div id="mobile">
					<header class="chat_header" id="head">
				        <div class="back" id="back" onclick="kefu.ui.list.entry();">&nbsp;</div>
				        <div class="title" id="title"><span id="nickname">在线咨询</span><span id="onlineState">在线</span></div>
				    </header>
					<div id="newMessageRemind">
						<div id="newMessageRemindText"><!-- 新消息：消息内容消息内容 --></div>
						<div id="newMessageRemindClose" onclick="document.getElementById('newMessageRemind').style.display='none';">X</div>
					</div>
					
				    <section id="chatcontent" onclick="kefu.chat.switchToJianpanShuruType();">
				    </section>
				    
				    <footer id="chat_footer">
				        <div id="input_area">
				            <div id="textInput">
				            	<div id="shuruType" onclick="kefu.chat.shuruTypeChange();"><!--输入方式--></div>
				                <!-- 键盘输入 -->
				                <!-- <input type="text" id="text111" onclick="kefu.ui.chat.textInputClick();"> -->
				                <div id="text" contenteditable="true" onclick="kefu.ui.chat.textInputClick();"></div>
				                <input type="submit" value="发送" class="send" id="sendButton" onclick="kefu.chat.sendButtonClick();">
				            </div>
				            <div id="inputExtend">
				                <!-- 其他，如图片、商品、订单 -->
	
				            </div>    
				            <div id="inputExtendShowArea">
				                <!-- inputExtend的显示区域，如表情的显示 -->
				            </div>
				        </div>
				    </footer>
				</div>
			`,
			//发送一条消息，在双方聊天的消息末尾追加消息
			appendMessage: function(message){
				if(typeof(message) == 'string'){
			        message = JSON.parse(message);   //转成json
			    }
			    //判断一下，消息的类型。
			    if(message == null){
			        return;
			    }
			    if(message.type == 'SYSTEM'){
			        //系统类型消息
			        kefu.ui.chat.appendSystemMessage(kefu.filterXSS(message['text']));
			    }else{
			        //其他类型，那么出现对话框的
			        var section = kefu.ui.chat.generateMessageSection(message);
			    
			        document.getElementById('chatcontent').appendChild(section);
			        //滚动条滚动到最底部
			        kefu.ui.chat.scrollToBottom();
			    }
			},
			//创建聊天正常沟通收发消息的 section dom 元素
			generateMessageSection:function(message){
				if(message != null && typeof(message.text) != 'undefined' && message.text != ''){
					//已经有显示出来的消息内容了，那可以直接显示出来
				}else{
					//没有直接显示出来的消息内容，需要正则一下，赋予 message.text 消息内容
					message['text'] = kefu.getReceiveMessageText(message);
				}
				
			    //发送文本消息后绘制对话窗口
			    var section = document.createElement("section");
			    //要用kefu.chat.otherUser来判断，不能用 kefu.user, kefu.user 异步获取，有可能kefu.user 还没获取到
			    if(message['receiveId'] == kefu.chat.otherUser.id){
			        //是自己发送的这条消息，那么显示在右侧
			        section.className = 'chat user '+message['type'];
			        section.innerHTML = '<div class="head"></div><div class="sanjiao"></div><div class="text">'+kefu.ubb(message['text'])+'</div>';
			    }else if(message['sendId'] == kefu.chat.otherUser.id){
			        //是自己接受的这个消息，那么显示在左侧
			        section.className = 'chat otherUser '+message['type'];
			        section.innerHTML = '<div class="head" style="background-image: url('+kefu.getImageUrl(kefu.chat.otherUser.head)+');"></div><div class="sanjiao"></div><div class="text">'+message['text']+'</div>';
			    }
			    return section;
			},
			//创建聊天系统提示消息的 section dom 元素 
			generateSystemMessageSection:function(text){
				var section = document.createElement("section");
				section.className = 'chat bot systemChat';
				section.innerHTML = '<div class="text systemText">'+text+'</div>';
				return section;
			},
			//聊天窗口滚动到最底部
			scrollToBottom:function(){
				//console.log('height:'+document.getElementById('chatcontent').scrollHeight);
				document.getElementById('chatcontent').scrollTo(0,document.getElementById('chatcontent').scrollHeight);
			},
			//在当前chat一对一聊天界面的消息最末尾追加显示一条系统消息, text:要显示的消息内容
			appendSystemMessage:function(text){
				chatcontent = document.getElementById('chatcontent');
				chatcontent.innerHTML =  chatcontent.innerHTML + 
					'<section class="chat bot systemChat"><div class="text systemText">'+text+'</div></section>';
				kefu.ui.chat.scrollToBottom();
			},
			//新消息提醒，当我跟A用户一对一聊天时，恰好B用户给我发送消息了，这时要在当前的chat一对一聊天页面中，显示B用户给我发送消息的提示，提醒用户B用户也给我发消息了。
			//message:接收到的消息对象，json对象。这里message.text已经是可以显示给用户的消息内容，已经处理好了，直接调用显示即可。
			newMessageRemind:function(message){
				kefu.cache.getUser(message.sendId, function(user){
					var remindTextDiv = document.getElementById('newMessageRemindText');
					remindTextDiv.innerHTML = user.nickname + ' : ' + message.text;
					remindTextDiv.onclick = function(){
						//点击后跳转到跟这个人的聊天窗口中对话。
						kefu.ui.chat.render(message.sendId);
					};
					//显示这条消息
					document.getElementById('newMessageRemind').style.display = 'block';
				});
			},
			//文字输入框被点击，隐藏扩展功能区域,已废弃，有 kefu.chat.switchToJianpanShuruType() 代替
			textInputClick:function (){
				//切换到键盘输入方式
				kefu.chat.switchToJianpanShuruType();
			},
			//渲染出chat一对一聊天页面。 otherUserId跟我聊天的对方的userid
			render:function(otherUserId){
				
				//加载跟这个人聊天的历史对话记录。不过当前是在获取对方数据之前先拉历史记录，kefu.chat.otherUser 肯定是null，所以先赋予默认值
				kefu.chat.otherUser = {
						id:otherUserId || 'lll',	
						nickname:'加载中..',
						head:'./images/head.png'
				}
				if(document.getElementById('shuruType') != null){
					//先设置输入方式是more，然后切换一次，切换回键盘输入
					kefu.chat.shuruType = 'more';
					kefu.chat.shuruTypeChange();
				}
				
			    // //获取聊天对方的用
				
				//如果chat显示，那么自动执行插件的initChat 方法,如果插件设置了的话
				for(var key in kefu.extend){
					if(kefu.extend[key].initChat != null){
						try{
							//避免某个模块中的初始化失败，导致整个im 初始化中断
							kefu.extend[key].initChat();
						}catch(e){ console.log(e); }
					}
				}
			},
			//进入chat页面，打开chat页面。如从list列表页面中，点击某项打开跟某人的chat聊天窗口，点击触发的就是这个。
			//传入userid，字符串类型，跟谁聊天，就传入谁的userid
			entry:function(userid){
				kefu.currentPage = 'chat';
				kefu.ui.chat.render(userid);
				//从list中标记这个用户的聊天已经全部看过了，将未读消息变为已读消息
				var cacheList = kefu.cache.getChatList();
				var message = null;
				for(var i = cacheList.length; i >= 0; i--){ 
					if(typeof(cacheList[i]) != 'undefined' && userid == cacheList[i].id){
						message = cacheList[i];
					}
				}
				if(message != null){
					//如果这个chat窗口在list中有缓存消息，那么将其中的read变为已读
					if(!message.read){
						message.read = true;
						kefu.cache.getUser(userid, function(user) {
							kefu.cache.pushChatList(user, message);
							if(kefu.mode == 'pc'){
								//如果是pc模式，那么还要刷新list
								kefu.ui.list.render();
							}
						})
					}
				}
			},
		}
		
	},
	/* 在聊天窗口中使用的 */
	chat:{
		otherUser:{},	//当前用户正在跟谁聊天，对方的user信息。每当打开一个跟某人的聊天窗时，会自动初始化此信息
		chatMessageStartTime:0,	//当前正在跟这个用户聊天时，聊天窗口中显示的消息列表的开始时间，13位时间戳，会根据这个来加载用户的网上滑动的消息
		shuruType:'jianpan',	//当前输入方式，默认进入是键盘方式输入。取值两个， jianpan:键盘方式输入； more:更多输入方式
		
		/**
		 * 获取当前聊天窗口中，跟我聊天的对方的user信息
		 * @param chatid 当前谁在跟谁聊天，对方的chatid。 如果是正常的坐席id，那么这里是32位uuid，如果是kefu.chatid，那么这里是 kefuchatid_ + 32位uuid
		 * @param func 获取到对方的用户信息后，要执行的方法
		 */
		getOtherUser:function(chatid, func){
			var gainApiUrl = '';
			if(chatid.indexOf('kefuchatid_') == 0){
				//是kefu.chatid
				if(kefu.api.getChatOtherUserByKefuChatid == null || kefu.api.getChatOtherUserByKefuChatid.length < 1){
					msg.popups('请设置 kefu.api.getUserByKefuChatId 接口，用于获取分配的客服坐席');
					return;
				}
				gainApiUrl = kefu.api.get(kefu.api.getChatOtherUserByKefuChatid);
			}else{
				//是正常的chatid
				if(kefu.api.getChatOtherUser == null || kefu.api.getChatOtherUser.length < 1){
					msg.popups('请设置 kefu.api.getChatOtherUser 接口，用于获取跟我沟通的对方的信息');
					return;
				}
				gainApiUrl = kefu.api.get(kefu.api.getChatOtherUser);
			}
			
			request.post(gainApiUrl,{token:kefu.token.get(), id:chatid}, function(data){
				kefu.chat.otherUser = data.user;
				if(typeof(func) != 'undefined'){
					func(data);
				}
			});
		},
		currentLoadHistoryList:false,	//跟loadHistoryList() 一起用，当加载历史列表时，此处为true，加载完后，此处变为false
		/* 加载历史聊天列表 */
		loadHistoryList(){
			if(!kefu.chat.currentLoadHistoryList){
				kefu.chat.currentLoadHistoryList = true;	//标记正在请求历史记录中
				if(kefu.cache.getUserMessageList(kefu.chat.otherUser.id).length < kefu.cache.everyUserNumber){
					//如果跟对方聊天的记录，本地缓存的几率条数小于本地缓存最大条数，那么就是刚开始聊天，都还没超过缓存最大数，那么也就没必要在从服务器拉更多聊天记录了
					console.log('聊天记录不足，没必要再拉更多');
					return;
				}

				var chatcontent = document.getElementById('chatcontent');
				var firstItem = chatcontent.getElementsByTagName("section")[0];

				//创建加载中的提示
				var section = document.createElement("section");
				section.className = 'chat bot systemChat';
				section.id = 'historyListLoading';
				section.innerHTML = '<div class="text systemText">历史聊天加载中...</div>';
				chatcontent.insertBefore(section,firstItem);

				//创建网络请求
				request.post(kefu.api.get(kefu.api.chatLog),{token:kefu.token.get(),otherId:kefu.chat.otherUser.id, time:kefu.chat.chatMessageStartTime, type:'before'}, function(data){
					kefu.chat.currentLoadHistoryList = false;	//标记请求历史记录已请求完成，可以继续请求下一次聊天记录了

					var chatcontent = document.getElementById('chatcontent');
					//删除聊天记录加载中的提示
					chatcontent.removeChild(document.getElementById('historyListLoading'));
					//删除聊天记录加载中的提示section后，取第一个正常聊天沟通的section，用来作为插入的定位
					var firstItem = chatcontent.getElementsByTagName("section")[0];

					if(data.result == '0'){
						//如果失败了，那么就删掉绑定的滚动条监控，避免死循环一直请求
						document.getElementById('chatcontent').onscroll = function(){}
						//失败，弹出提示
						msg.failure(data.info);
					}else if(data.result == '1'){
						//成功
						//判断一下请求到的消息记录有多少条

						if(data.number > 0){
							//有消息记录，那么绘制出来
							for(var i = data.list.length-1; i >= 0; i--){
								var message = data.list[i];
								message.from = 'hostory';
								var msgSection = kefu.ui.chat.generateMessageSection(message);
								chatcontent.insertBefore(msgSection,firstItem);
							}
							//重新标记历史消息的开始时间
							kefu.chat.chatMessageStartTime = data.startTime;
						}else{
							//没有更多消息了
							kefu.chat.currentLoadHistoryList = true;	//标记请求历史记录不再继续请求了，因为已经没有更多记录了
							//msg.info('没有更多消息了');
							chatcontent.insertBefore(kefu.ui.chat.generateSystemMessageSection('没有更多了'),firstItem);
						}

						
						
						
					}
				});
			}
		},
		/* 常见问题 */
		question:function(obj){
			var text = obj.innerHTML;
			kefu.chat.sendTextMessage(text);
		},
		/* 发送文本格式消息  text:要发送的文本消息。 返回json对象的message */
		sendTextMessage:function(text){
			text = text.replace(/\n/g,'[br]');	//将用户输入的换行替换为[br]
			var data = {
		    	token:kefu.token.get(),
		    	type:'MSG',	//消息类型
		    	sendId:kefu.user.id,		//发送者ID
		    	receiveId:kefu.chat.otherUser.id,	//接受者id
		    	text:text,
		        time:new Date().getTime()      
		    }
		    var message = JSON.stringify(data);
		    kefu.ui.chat.appendMessage(message);    //聊天窗口增加消息
		    // kefu.socket.send(message);       //socket发送
		    // kefu.cache.add(message);   //缓存

		    return message;
		},
		/*
		 * 发送插件消息。只有插件消息的发送才使用这个。正常发送文字消息使用的是 sendTextMessage
		 * @param data 要发送的插件消息的消息体对象，如 {goodsid:'123',goodsName:'西瓜', price:'12元'} ，但是为json对象的格式
		 * @param name 发送这个消息的插件的名字，比如这个插件是 kefu.extend.explain ，那么这里传入的是 'explain'
		 */
		sendPluginMessage:function(data, name){
			if(name == null){
				msg.popups('kefu.chat.sendPluginMessage(data,name) 方法中，请传入name的值。<br/>name是发送这个消息的插件的名字，比如这个插件是 kefu.extend.explain ，那么这里传入的是 \'explain\'');
				return;
			}
			if(data != null){
				data.name = name;
			}else{
				data = {};
			}
			
			//接收人chatid
			var receivdId = '';
			if(kefu.chat.otherUser != null && typeof(kefu.chat.otherUser.id) != 'undefined'){
				receivdId = kefu.chat.otherUser.id;
			}else{
				receivdId = null;
			}
			
			//组合后的消息体
			var message = {
				token:kefu.token.get(),
				receiveId:receivdId,
				sendId:kefu.user.id,
				type:'EXTEND',
				time:new Date().getTime(),
				extend:data
			};
			//更新聊天窗口
			if(kefu.extend[name] != null && typeof(kefu.extend[name]) == 'undefined' && typeof(kefu.extend[name]).format != 'undefined'){
				message.text = kefu.extend[name].format(message);
			}else{
				console.log('提示: '+name+'插件中， format 方法未实现，那么聊天消息体中这个插件的消息将不会出现。如果你想这个插件发送的消息能出现在聊天窗口中，请重写实现这个插件的 format 方法。可参考文档：  https://gitee.com/leimingyun/dashboard/wikis/leimingyun/kefujs-api-interface-of/preview?sort_id=3663420&doc_id=1274007');
			}
			
			kefu.ui.chat.appendMessage(message);
			
			//socket发送消息
			message.text = '';	//清理掉message.text 因为这个本来就是自动生成出来的不必额外占用带宽、流量
			kefu.socket.send(message);

			kefu.cache.add(message);   //缓存
		},
		//text文本，打字沟通交流， 点击提交按钮后发送
		sendButtonClick:function (){
		    var value = document.getElementById('text').innerHTML;
		    if(value.length == 0){
		        msg.info('尚未输入');
		        return;
		    }

		    //接口提交-文本对话，输入文字获取对话结果
		    msg.loading("发送中");    //显示“更改中”的等待提示
		    
		    kefu.chat.sendTextMessage(document.getElementById('text').innerHTML);
			setTimeout(() => {
				msg.close();	//关闭发送中提示
			}, 400);
		    //清空内容区域
		    document.getElementById('text').innerHTML = '';

		    //隐藏表情等符号输入区域
		    kefu.ui.chat.textInputClick();
		},
		//输入类型改变，切换，比如有更多切换到键盘输入
		shuruTypeChange:function(){
			//设置底部的输入方式切换
			if(document.getElementById('shuruType') == null){
				return;
			}
			if(kefu.chat.shuruType == 'jianpan'){
				//当前是键盘输入，切换到更多输入方式
				kefu.chat.shuruType = 'more';
				document.getElementById('shuruType').innerHTML = kefu.ui.images.jianpan.replace(/{color}/g,kefu.ui.color.shuruTypeColor);
				
				//更多输入放大
				var inputExtendHtml = '';
				for(var key in kefu.extend){
				    if(kefu.extend[key].icon != null && kefu.extend[key].icon.length > 0){
				    	inputExtendHtml = inputExtendHtml + 
					    	'<div class="item" onclick="kefu.extend[\''+key+'\'].onclick();"><div class="iconButton">'+(kefu.extend[key].icon.replace(/{color}/g, kefu.ui.color.extendIconColor))+'</div><div class="iconName">'+kefu.extend[key].name+'</div></div>'; 
				    }
				}
				document.getElementById('inputExtend').innerHTML = inputExtendHtml;
				//显示扩展功能栏
				document.getElementById('inputExtend').style.display = '';
				
				//显示 插件内容显示的区域，如表情插件显示出来的表情选择所在的区域
				document.getElementById('inputExtendShowArea').style.display = '';
			}else{
				//当前是更多输入，切换到键盘输入方式
				kefu.chat.shuruType = 'jianpan';
				document.getElementById('shuruType').innerHTML = kefu.ui.images.more.replace(/{color}/g,kefu.ui.color.shuruTypeColor);;
				
				//清空掉插件内容显示的区域，如表情插件显示出来的表情选择所在的区域，将表情列表清空掉
				document.getElementById('inputExtendShowArea').innerHTML = '';
				
				//更多简化缩小
				var inputExtendHtml = '';
				for(var key in kefu.extend){
					if(kefu.extend[key].icon != null && kefu.extend[key].icon.length > 0){
						inputExtendHtml = inputExtendHtml + '<span class="smallIcon" onclick="kefu.extend[\''+key+'\'].onclick();">'+ (kefu.extend[key].icon.replace(/{color}/g, kefu.ui.color.extendIconColor)) + '</span>';
				    }
				}
				document.getElementById('inputExtend').innerHTML = '<div class="extendSmallIcon">'+inputExtendHtml+'</div>';
			}
		},
		//切换到键盘输入类型
		switchToJianpanShuruType(){
			//设置底部的输入方式切换
			if(document.getElementById('shuruType') == null){
				return;
			}
			if(kefu.chat.shuruType != 'jianpan'){
				//如果当前不是键盘输入，那么触发执行输入类型改变
				this.shuruTypeChange();
			}
		}

	},
	cache:{
		everyUserNumber:20,	//每个用户缓存20条最后的聊天记录
		/* 根据userid，获取跟这个用户的本地缓存的20条最近聊天记录 */
		getUserMessageList:function(userid){
			var chatListStr = kefu.storage.get('userid:'+userid);
			if(chatListStr == null || chatListStr.length < 1){
				chatListStr = '[]';
			}
			var chatList = JSON.parse(chatListStr);
			return chatList;
		},
		/* 发送或者接收消息，都会加到这里，进行缓存 */
		add:function(message){
			if(typeof(message) == 'string'){
				var message = JSON.parse(message);	//转成json
			}
			var otherUserId = 0;	//聊天对方的userid
			if(message['sendId'] == kefu.user.id){
				//这条消息是自己发送出去的
				otherUserId = message['receiveId'];
			}else if(message['receiveId'] == kefu.user.id){
				//自己是消息接收者，别人发过来的消息
				otherUserId = message['sendId'];
			}
			//判断一下消息类型，如果是系统提示消息， type = 'SYSTEM' ，没意义的提醒，那么不保存
			if(message['type'] == 'SYSTEM'){
				return;
			}
			if(otherUserId != '0' && otherUserId.length > 0){
				message['from'] = 'cache';

				//保存单独跟这个用户的聊天记录
				var chatUserStr = kefu.storage.get('userid:'+otherUserId);
				if(chatUserStr == null || chatUserStr.length < 1){
					chatUserStr = '[]';
				}
				var chatUser = JSON.parse(chatUserStr);
				chatUser.push(message);
				if(chatUser.length > this.everyUserNumber) {
					//console.log('移除：'+chatUser[0]);
					chatUser.splice(0, 1);	//移除最后一个
				}
				kefu.storage.set('userid:'+otherUserId, JSON.stringify(chatUser));
				//console.log('保存：'+JSON.stringify(chatList))

				//保存聊天列表的最后一条聊天消息
				//判断一下当天保存的消息，是否是 kefu.chat.otherUser 这个人的，如果不是，那么要重新拉取message.sendId 这个用户的信息
				if(kefu.chat.otherUser != null && kefu.chat.otherUser.id != null && kefu.chat.otherUser.id == otherUserId){
					kefu.cache.pushChatList(kefu.chat.otherUser, message);
				}else{
					//不是这个人的，那么用getUser来取用户信息
					kefu.cache.getUser(otherUserId, function(user) {
						kefu.cache.pushChatList(user, message);
					})
				}
			}
		},
		/* 获取聊天列表的缓存 */
		getChatList:function(){
			var chatListStr = kefu.storage.get('list');
			if(chatListStr == null || chatListStr.length < 1){
				chatListStr = '[]';
			}
			var chatList = JSON.parse(chatListStr);
			return chatList;
		},
		// 往聊天列表中添加最后一次沟通的记录 otherUser 用户对象信息    message:消息json
		pushChatList:function(otherUser, message){
			if(otherUser == null){
				msg.popups('出错，kefu.cache.pushChatList 传入的 otherUser 为null');
				return;
			}
			var chatList = this.getChatList();

			//聊天内容
			var text = message.text;
		    if(message.type == 'EXTEND'){
		        text = kefu.extend[message.extend.name].name;
		    }

			//组合新的消息
			var newMessage = {
				id:otherUser.id,	//对方的userid
				text:text,		//最后一次沟通的内容
				nickname:otherUser.nickname,	//对方的昵称
				head:kefu.getImageUrl(otherUser.head), 	//对方的头像
				time:message.time, 			//消息产生的时间。
				read:message.read		//消息是否已读
			}
			if(newMessage.time == null){
				newMessage.time = parseInt(new Date().getTime()/1000);
			}

			var chatListLength = chatList.length;
			for (var i = 0; i < chatListLength; i++) {
				if(chatList[i] != null && chatList[i]['id'] == otherUser.id){
					chatList.splice(i, 1);	//移除跟这个用户的上一条记录。以便存最新的
					continue;
				}
			}
			chatList.push(newMessage);
			kefu.storage.set('list', JSON.stringify(chatList));
		},
		/*
		 * 通过userid，获取这个用户的其他信息。
		 * @param userid 要获取的是哪个用户的信息
		 * @param func 获取到这个用户信息后，要执行的方法。传入 function(user){ console.log(user); }
		 * @return 如果缓存中有这个用户的信息，那么直接返回这个user对象。 如果没有，那么返回null。 这个返回值大多数情况用不到，都是使用 func 进行处理的
		 */
		getUser:function(userid, func){
			var user;
			var cache_key = 'user_id_'+userid;
			var userStr = kefu.storage.get(cache_key);
			if(userStr == null || userStr.length < 1){
				//从网络获取
				request.send(kefu.api.get(kefu.api.getChatOtherUser),{token:kefu.token.get(), id:userid}, function(data){
					//请求完成
					if(data.result == '1'){
						user = data.user;
						kefu.storage.set(cache_key, JSON.stringify(data.user));
						if(func != null){
							func(user);
						}
					}else{
						console.log('kefu.api.getChatOtherUser 获取异常：'+data.info);
					}
				},'post', true, {'content-type':'application/x-www-form-urlencoded'}, function(xhr){
					//异常
					console.log('kefu.cache.getUser() 异常：');
					console.log(xhr);
				})
				
			}else{
				user = JSON.parse(userStr);
				func(user);
			}
			
			return user;
		}
	},
	/* 扩展，比如表情、图片、订单、商品 */
	extend:{
		/* 表情 */
		face:{
			name:'表情',
			icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1603894373099" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2514" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M512 979C263.472 979 62 777.528 62 529S263.472 79 512 79s450 201.472 450 450-201.472 450-450 450zM337 479c41.421 0 75-33.579 75-75s-33.579-75-75-75-75 33.579-75 75 33.579 75 75 75z m350 0c41.421 0 75-33.579 75-75s-33.579-75-75-75-75 33.579-75 75 33.579 75 75 75zM312 629c0 110.457 89.543 200 200 200s200-89.543 200-200H312z" fill="{color}" p-id="2515"></path></svg>',
			/* 将message.extend 的json消息格式化为对话框中正常浏览的消息 */
			format:function(message){
				return message;
			},
			faces:{
				xiaolian:'😀',
				huaixiao:'😁',
				se:'😍',
				feiwen:'😘',
				waiziuxiao:'😏',
				yumen:'😒',
				ai:'😔',
				tu:'🤮',
				yun:'😵',
				nanguo:'🙁',
				jingkong:'😲',
				ku:'😭',
				yangmei:'🤨',
				miyan:'😆',
				liuhan:'😅',
				weixiao:'🙂',
				xiaoxingxing:'🤩',
				sikao:'🤔',
				xu:'🤫',
				yanmaoqian:'🤑',
				shenshetou:'😝'
			},
			/* 点击后显示表情选择 */
			onclick:function (){
				var html = '<div id="inputExtend_Face">';
				for(var key in kefu.extend.face.faces){
					html = html + '<span onclick="kefu.extend.face.insert(\''+key+'\');">'+kefu.extend.face.faces[key]+'</span>';
				};
				html = html+'</div>';

				//隐藏扩展功能栏
				document.getElementById('inputExtend').style.display = 'none';
				document.getElementById('inputExtendShowArea').style.display = '';

				document.getElementById('inputExtendShowArea').innerHTML = html;
				
				//标记当前正在使用扩展的输入方式，而非键盘输入方式了
				kefu.chat.shuruType = 'more';
			},
			/* 向输入框中插入表情 */
			insert:function (key){
				document.getElementById('text').innerHTML = document.getElementById('text').innerHTML + kefu.extend.face.faces[key];
			}

		},
		/* 图片上传 */
		image:{
			name:'图片',
			icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1603894900121" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2954" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M955.733333 136.533333H68.266667c-37.546667 0-68.266667 30.72-68.266667 68.266667v614.4c0 37.546667 30.72 68.266667 68.266667 68.266667h887.466666c37.546667 0 68.266667-30.72 68.266667-68.266667V204.8c0-37.546667-30.72-68.266667-68.266667-68.266667z m-154.146133 171.485867a51.2 51.2 0 1 1 0 102.4 51.2 51.2 0 0 1 0-102.4z m48.520533 442.282667H174.1312c-32.392533 0-50.193067-37.6832-29.610667-62.702934l186.504534-226.781866a38.3488 38.3488 0 0 1 59.2384 0L556.373333 662.818133a38.3488 38.3488 0 0 0 59.2384 0l92.2624-112.1792a38.3488 38.3488 0 0 1 59.2384 0l112.64 136.977067c20.548267 25.002667 2.7648 62.685867-29.6448 62.685867z" fill="{color}" p-id="2955"></path></svg>',
			template:'<img style="max-width: 100%;" onclick="kefu.extend.image.fullScreen(\'{url}\');" src="{url}" />',
			initChat:function(){
				var inputEle = document.createElement("input");
				inputEle.setAttribute("accept", "image/gif,image/jpeg,image/jpg,image/png,image/svg,image/bmp");
				inputEle.id = 'imageInput';
				inputEle.style.display = 'none';
				inputEle.type = 'file';
				document.body.appendChild(inputEle);
			},
			/* 将message.extend 的json消息格式化为对话框中正常浏览的消息 */
			format:function(message){
				message.text = kefu.extend.image.template.replace(/{url}/g, kefu.filterXSS(kefu.getImageUrl(message.extend.url)));
				return message;
			},
			onclick:function(){
				//添加input改动监听
				if(document.getElementById('imageInput').oninput == null){
					document.getElementById('imageInput').oninput = function(e){
					    if(typeof(e.srcElement.files[0]) != 'undefined'){
					        var file = e.srcElement.files[0];
					        msg.loading('上传中');
					        request.upload(kefu.api.get(kefu.api.uploadImage), {token:kefu.token.get()}, file,function(data){
					            msg.close();
					            if(data.result == '1'){
					            	//组合extend的消息体
					            	var extend = {
					            			url:kefu.getImageUrl(data.url)
					            	};
					            	kefu.chat.sendPluginMessage(extend, 'image');
					            	
					            	//切换到键盘输入方式
					            	kefu.chat.switchToJianpanShuruType();
					            }else{
					            	msg.failure(data.info);
					            }
					            
					        }, null, function(){
					        	msg.close();
					            msg.failure('异常');
					        });
					        //清理掉input记录，避免上传两张相同的照片时第二次上传无反应
					        document.getElementById('imageInput').value = '';
					    }    
					}
				}

				document.getElementById('imageInput').click();
			},
			//放大全屏查看图片
			fullScreen:function(imageUrl){
				msg.popups({
					text:'<img src="'+imageUrl+'" style="width: 100%; max-width: 100%; " />',
					width:'95%',
					opacity:100,
					padding:'1px'
				});
			}
		},
		/* 语音，录音 */
		luyin : {
		    // name:'语音',	//插件的名字
		    // icon:'<svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="598"><path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0ZM681.514667 494.016c1.706667 0 3.370667 0.149333 5.205333 0.426667a30.144 30.144 0 0 1 24.32 34.837333 203.093333 203.093333 0 0 1-170.602667 165.610667v68.138666c0 16.64-13.333333 30.037333-29.930666 30.037334h-1.109334c-16.170667-0.554667-28.8-14.378667-28.8-30.741334v-67.861333a202.944 202.944 0 0 1-167.637333-165.184 32.682667 32.682667 0 0 1-0.426667-5.226667c0-16.64 13.354667-30.037333 29.930667-30.037333 14.613333 0 26.986667 10.709333 29.504 25.109333a142.613333 142.613333 0 0 0 114.944 115.392c77.269333 13.952 151.189333-37.802667 165.098667-115.413333a30.293333 30.293333 0 0 1 29.504-25.088z m-171.84-263.082667c56.490667 0 102.293333 45.994667 102.293333 102.698667v155.861333c0 56.704-45.802667 102.698667-102.293333 102.698667s-102.293333-45.994667-102.293334-102.698667V333.653333c0-56.704 45.802667-102.698667 102.293334-102.698666z" p-id="599" fill="{color}"></path></svg>', //插件的图标，一定要用这种svg格式的。
		    // js:'//最上边两百行',
		    onclick:function(){
				console.log('hhah')
				try{
					HZRecorder.get(function (rec) {
						kefu.extend.luyin.recorder = rec;
						kefu.extend.luyin.recorder.start();
					});
				}catch(e){
					console.log(e); 
					return;
				}
		        msg.popups({
					text:`
						<div onclick="kefu.extend.luyin.startLuyin(this);" style=" width: 100%; text-align: center; margin-left: 0.15rem; padding-top: 0.5rem; -webkit-touch-callout:none;  -webkit-user-select:none; -khtml-user-select:none;  -moz-user-select:none; -ms-user-select:none; user-select:none;" >
							<div style="padding-top: 0.5rem;" id="kefu_extend_luyin_svg"><svg style="width: 4rem;" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6364"><path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0ZM681.514667 494.016c1.706667 0 3.370667 0.149333 5.205333 0.426667a30.144 30.144 0 0 1 24.32 34.837333 203.093333 203.093333 0 0 1-170.602667 165.610667v68.138666c0 16.64-13.333333 30.037333-29.930666 30.037334h-1.109334c-16.170667-0.554667-28.8-14.378667-28.8-30.741334v-67.861333a202.944 202.944 0 0 1-167.637333-165.184 32.682667 32.682667 0 0 1-0.426667-5.226667c0-16.64 13.354667-30.037333 29.930667-30.037333 14.613333 0 26.986667 10.709333 29.504 25.109333a142.613333 142.613333 0 0 0 114.944 115.392c77.269333 13.952 151.189333-37.802667 165.098667-115.413333a30.293333 30.293333 0 0 1 29.504-25.088z m-171.84-263.082667c56.490667 0 102.293333 45.994667 102.293333 102.698667v155.861333c0 56.704-45.802667 102.698667-102.293333 102.698667s-102.293333-45.994667-102.293334-102.698667V333.653333c0-56.704 45.802667-102.698667 102.293334-102.698666z" p-id="6365" fill="#eeeeee"></path></svg></div>
							<div style="font-size: 0.9rem; padding-top: 1.3rem;" id="kefu_extend_luyin_text">点击开始录音</div>
						</div>`, 
					width:'8rem',
					height:'10rem'
				});
		    },
			format:function(message){
				message.text = '<audio src="'+kefu.filterXSS(message.extend.url)+'" controls="controls" style="max-width: 100%;">您的浏览器不支持 audio 标签。</audio>';
				return message;
			},
			recorder:null,
			//开始录音
			startLuyin:function(obj){
				obj.onclick=function(){
					kefu.extend.luyin.stopAndSend();
				};
				//弹出黑窗的关闭按钮，点击关闭将不在录音
				if(document.getElementsByClassName('msg_close').length > 0){
					document.getElementsByClassName('msg_close')[0].onclick=function(){
						kefu.extend.luyin.recorder.stop();
						msg.close();
					}
				}
				//onmouseup="console.log('up'); kefu.extend.luyin.stopAndSend();" 
				document.getElementById('kefu_extend_luyin_text').innerHTML = '录音中...<br/>点击结束录音';
				document.getElementById('kefu_extend_luyin_text').style.paddingTop = '0.8rem';
				document.getElementById('kefu_extend_luyin_svg').innerHTML = `<svg style="width: 4rem;" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7813"><path d="M513.97099632 1.80950267C232.79247314 1.80950267 4.54496541 230.05700825 4.54496541 511.23553144s228.24750558 509.42602875 509.42603091 509.42603087 509.42602875-228.24750558 509.42602873-509.42603087c-0.28005843-281.4585816-228.24750558-509.42602875-509.42602873-509.42602877z m-215.6448843 558.15617188c0 15.4032057-14.28297193 27.44571227-32.48676208 27.44571225s-30.52635298-12.32256502-30.52635295-30.52635298v-92.13917796c0-15.4032057 12.32256502-30.52635298 30.52635295-30.52635298 15.4032057 0 32.48676209 12.32256502 32.48676208 30.52635298v95.21981869z m123.78576476 73.93538784c0 18.20378796-14.28297193 30.52635298-32.48676209 30.52635515s-30.52635298-12.32256502-30.52635298-30.52635515v-245.61112036c0-15.4032057 12.32256502-30.52635298 30.52635298-30.52635296 15.4032057 0 32.48676209 12.32256502 32.48676209 30.52635296v245.61112036z m122.94558938 61.61282502c0 18.20378796-12.32256502 30.52635298-30.52635511 30.52635298s-30.52635298-12.32256502-30.52635301-30.52635298V326.67711915c0-15.4032057 12.32256502-30.52635298 30.52635301-30.52635298 15.4032057 0 30.52635298 12.32256502 30.52635511 30.52635298v368.83676826z m124.6259379-61.61282502c0 18.20378796-12.32256502 30.52635298-30.52635297 30.52635515s-30.52635298-12.32256502-30.52635298-30.52635515v-245.61112036c0-15.4032057 12.32256502-30.52635298 30.52635298-30.52635296 15.4032057 0 30.52635298 12.32256502 30.52635297 30.52635296v245.61112036z m122.66553098-73.93538784c0 15.4032057-12.32256502 27.44571227-30.52635299 27.44571225s-30.52635298-12.32256502-30.52635297-30.52635298v-92.13917796c0-15.4032057 12.32256502-30.52635298 30.52635297-30.52635298 15.4032057 0 30.52635298 12.32256502 30.52635299 30.52635298v95.21981869z" fill="#eeeeee" p-id="7814"></path></svg>`; 
				
				kefu.extend.luyin.recorder.start();
			},
			//结束录音并发送语音
			stopAndSend:function(){
				kefu.extend.luyin.recorder.stop();    //结束录音
				msg.loading('发送中');
				
				
				//获取音频文件
				var fd = new FormData();
				fd.append("file", kefu.extend.luyin.recorder.getBlob());
				var xhr = new XMLHttpRequest();
				//上传完成回调
				xhr.addEventListener("load", function (e) {
					msg.close();
					console.log('ok');
					console.log(e);
					//e.target.responseText即后台返回结果
					var data = eval('(' + e.target.responseText + ')');
					if(data.result == '1'){
						//成功
						kefu.chat.sendPluginMessage({
							url:data.url,
							size:data.size
						},'luyin');
						//切换到键盘输入方式
						kefu.chat.switchToJianpanShuruType();
					}else{
						//失败
						msg.failure(data.info);
					}
				}, false);
			
				//这里接口接收语音文件
				xhr.open("POST", kefu.api.get(kefu.api.uploadAudio));
				xhr.send(fd);
			}
		},
		/* 文件，发送文件 */
		file : {
		    // name:'文件',	//插件的名字
		    //icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1619840321163" class="icon" viewBox="0 0 1127 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4177" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M989.541 940.667h-858.923c0 0-68.409 10.642-68.409-80.572v-737.306c0 0 1.521-82.091 85.132-82.091h301.003c0 0 36.486-7.601 66.89 39.525 28.884 45.607 45.607 74.491 45.607 74.491 0 0 10.642 12.161 34.965 12.161-21.283 0 387.655 0 387.655 0 0 0 68.409-7.601 68.409 68.409v629.371c0 0 10.642 76.012-62.33 76.012zM925.692 362.984c0-18.243-15.202-33.445-33.445-33.445h-668.896c-19.763 0-34.965 15.203-34.965 33.445v3.040c0 19.763 15.202 34.965 34.965 34.965h668.896c18.243 0 33.445-15.203 33.445-34.965v-3.040z" fill="{color}" p-id="4178"></path></svg>', //插件的图标，一定要用这种svg格式的。
		    onclick:function(){
		    	var input = document.createElement("input");
		    	input.type = "file";
		    	input.click();
		    	input.onchange = function(){
		    		var file = input.files[0];
		    		
		    		var fd = new FormData();
					fd.append("file", file);
					var xhr = new XMLHttpRequest();
					//上传完成回调
					xhr.addEventListener("load", function (e) {
						msg.close();
						console.log(e);
						//e.target.responseText即后台返回结果
						var data = eval('(' + e.target.responseText + ')');
						if(data.result == '1'){
							//成功
							kefu.chat.sendPluginMessage({
								url:data.url,
								size:data.size,
								fileName:data.fileName
							},'file');
							//切换到键盘输入方式
							kefu.chat.switchToJianpanShuruType();
						}else{
							//失败
							msg.failure(data.info);
						}
					}, false);
					//这里接口接收文件
					xhr.open("POST", kefu.api.get(kefu.api.uploadFile));
					xhr.send(fd);
		    	};
		    },
			format:function(message){ 
				message.text = '<div style="cursor:pointer; " onclick="window.open(\''+message.extend.url+'\');"><div style="width: 3rem; float: left; height: 3rem;">'+kefu.extend.file.icon.replace(/{color}/g,kefu.ui.color.extendIconColor)+'</div><div style="text-align: left; font-size: 0.9rem; line-height: 1.4rem;width: 100%;margin-left: 3.6rem;"><div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%; font-size: 1rem;">'+kefu.filterXSS(message.extend.fileName)+'</div><div style="font-size: 0.7rem;">大小:'+ (message.extend.size/1)+'KB</div></div></div>';
				return message;
			}

		},
		
		/* 订单 */
		order:{
			//name:'订单',
			//icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1603894275814" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1559" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M128 891.663059h768a128 128 0 0 0 128-128V260.336941a128 128 0 0 0-128-128H128A128 128 0 0 0 0 260.336941v503.326118a128 128 0 0 0 128 128z m83.425882-475.376941v281.178353c0 31.051294-57.705412 31.171765-57.705411 0V334.697412c0-21.202824 7.589647-31.051294 22.64847-31.834353 12.137412-0.632471 25.057882 5.692235 38.701177 24.244706l202.390588 275.365647v-272.323765c0-37.255529 55.898353-37.225412 55.898353 0v362.767059c0 18.100706-7.559529 26.383059-22.648471 27.196235-13.673412 0.722824-24.786824-6.746353-36.261647-22.64847L211.425882 416.286118z m292.352 149.62447c0-213.232941 272.022588-212.781176 272.022589 0 0 206.667294-272.022588 208.956235-272.022589 0z m52.555294 0c0 128.813176 165.586824 133.782588 165.586824 0 0-73.667765-40.749176-103.695059-83.245176-102.912-42.496 0.783059-82.341647 32.406588-82.341648 102.912z m285.093648 97.249883c15.872 0 28.822588 12.950588 28.822588 28.822588s-12.950588 28.822588-28.822588 28.822588-28.822588-12.950588-28.822589-28.822588 12.950588-28.822588 28.822589-28.822588z" fill="{color}" p-id="1560"></path></svg>',
			//css:'./extend/order/style.css',	//引入这个扩展的自定义css。引入的这个css会在加载完kefu.js后立马加载引入这里的css
			//请求的api接口
			requestApi:'orderList.json',
			/* 将message.extend 的json消息格式化为对话框中正常浏览的消息 */
			format:function(message){
				message.text = kefu.extend.order.getOrderByTemplate(message.extend);
				return message;
			},

			/*
				订单号 {order.no}
				订单时间 {order.time}
				订单商品的图片 {goods.image}
				订单商品的名字 {goods.name}
				商品的价格 {goods.price}
				订单的状态 {order.state}
			*/
			listTemplate:`
				<div class="extend_order_item" onclick="kefu.extend.order.sendOrder('{order.no}', this, '{id}');">  
				    <div class="orderInfo">
				        <div class="order_no">订单号：{order.no}</div>
				        <div class="order_time">{order.time}</div>
				    </div>
				    <div class="goodsInfo">
				    	<img class="image" src="{goods.image}" />
					    <div class="goodsAttr">
					        <div class="name">{goods.name}</div>
					        <div class="priceState">
					            <div class="price">{goods.price}</div>
					            <div class="state">{order.state}</div>
					        </div>
					    </div>
				    </div>
				</div>
				<hr class="extend_order_hr" />
			`,

			orderMap:{},	//key: goodsid

			getOrderByTemplate:function(order){
				return kefu.extend.order.listTemplate
							.replace(/{order.no}/g, kefu.filterXSS(order['no']+''))
							.replace(/{order.time}/g, kefu.filterXSS(order['time']+''))
							.replace(/{goods.image}/g, kefu.filterXSS(order['image']))
							.replace(/{id}/g, kefu.filterXSS(order['id']+''))		//唯一标识，仅此而已
							.replace(/{goods.name}/g, kefu.filterXSS(order['name']))
							.replace(/{goods.price}/g, kefu.filterXSS(order['price']+''))
							.replace(/{order.state}/g, kefu.filterXSS(order['state']+''));
			},
			onclick:function (){
				msg.loading('获取中');
				request.post(kefu.extend.order.requestApi,{token:kefu.token.get(), zuoxiid:kefu.chat.otherUser.id, myid:kefu.user.id}, function(data){
					msg.close();
					var html = '';
					for (var i = 0; i < data.length; i++) {
						kefu.extend.order.orderMap[data[i]['id']] = data[i];
						html = html + kefu.extend.order.getOrderByTemplate(data[i]);
					};
					msg.popups({
						text:html,
						top:'10%',
						height:'20rem'
					});
				});
			},
			//发送某个订单 orderid: 订单id、或订单号， obj:点击的当前dom对象， uniqueId:当前点击项在这个订单列表中的唯一id标识，在这些订单列表中是唯一
			sendOrder:function (orderid, obj, uniqueId){
				var parentClassName = obj.parentElement.className;	//获取当前触发的onclick div的父级元素的class 的 name
				if(parentClassName == 'text'){
					//在聊天窗口中点击的，那么调取原生直接进入订单详情页面
					kefu.extend.order.otherShow(orderid);
					return;
				}
				var order = kefu.extend.order.orderMap[uniqueId];
				msg.close();
				
				kefu.chat.sendPluginMessage(order, 'order');
			},
			//在第三方平台中，点击订单这个消息后打开的。 orderid 订单的id
			otherShow:function(orderid){
				if(typeof(window.webkit) != 'undefined' && typeof(window.webkit.messageHandlers) != 'undefined'){
					if(typeof(window.webkit.messageHandlers.appShowOrder.postMessage) == 'function'){
						window.webkit.messageHandlers.appShowOrder.postMessage(orderid);
					}
				}else{
					alert('待编写。这里应该是跳转到原生app的订单详情中进行查看');
				}
			}
		},
		/* 商品 */
		goods:{
			//name:'商品',
			//chat:'<span onclick="">商品</span>',
			//css:'./extend/goods/style.css',	//引入这个扩展的自定义css。引入的这个css会在加载完kefu.js后立马加载引入这里的css
			//初始化，kefu.js 加载完毕后会先引入指定路径的js，再执行此方法
			init:function(){

			},
			/* 将message.extend 的json消息格式化为对话框中正常浏览的消息 */
			format:function(message){
				message.text = kefu.extend.goods.getGoodsByTemplate(message.extend);
				return message;
			},
			/*
				商品图片 {image}
				商品名字 {name}
				商品价格 {price}
			*/
			template : `
				<!-- 弹出的商品发送 -->
			    <div class="extend_goods_item" onclick="kefu.extend.goods.sendGoods('{id}', this);">  
			        <img class="image" src="{image}" />
			        <div class="goodsInfo">
			            <div class="name">{name}</div>
			            <div class="priceDiv">
			            	<div class="price">{price}</div>
			            	<div class="sendButtonDiv"><button>发送商品</button></div></div>
			        </div>
			    </div>
			`,
			goods:{},
			getGoodsByTemplate : function (goods){
				return kefu.extend.goods.template
						.replace(/{id}/g, kefu.filterXSS(goods['id']))
						.replace(/{name}/g, kefu.filterXSS(goods['name']))
						.replace(/{price}/g, kefu.filterXSS(goods['price']))
						.replace(/{image}/g, kefu.filterXSS(goods['image']));
			},
			//发送商品
			sendGoods : function (goodsid, obj){
				var parentClassName = obj.parentElement.className;	//获取当前触发的onclick div的父级元素的class 的 name
				if(parentClassName == 'text'){
					//在聊天窗口中点击的，那么调取原生直接进入订单详情页面
					kefu.extend.goods.otherShow(goodsid);
					return;
				}

				if(goodsid != kefu.extend.goods.goods.id){
					msg.failure('商品id异常！');
				}
				msg.close();
				
				kefu.chat.sendPluginMessage(kefu.extend.goods.goods, 'goods');
			},
			//在第三方平台中，点击订单这个消息后打开的。 orderid 订单的id
			otherShow:function(goodsid){
				if(typeof(window.webkit) != 'undefined' && typeof(window.webkit.messageHandlers) != 'undefined'){
					//ios上用
					if(typeof(window.webkit.messageHandlers.appShowGoods.postMessage) == 'function'){
						window.webkit.messageHandlers.appShowGoods.postMessage(goodsid);
					}
				}else{
					alert('待编写。这里应该是跳转到原生app的商品详情中进行查看');
				}
			}
		},
		//只是实现了format方法，可以看历史记录而已，具体功能需要引入对应功能js文件
		videoCall:{
			name:'视频通话',
			//icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1620038475713" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6099" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M782.378667 106.666667a42.666667 42.666667 0 0 1 42.666666 42.666666v170.666667a42.666667 42.666667 0 0 1-42.666666 42.666667h-213.333334a42.666667 42.666667 0 0 1-42.666666-42.666667v-170.666667a42.666667 42.666667 0 0 1 42.666666-42.666666h213.333334z m149.333333 34.56a21.333333 21.333333 0 0 1 21.333333 21.333333v144.213333a21.333333 21.333333 0 0 1-30.890666 19.114667L825.173333 277.333333v-85.333333l97.024-48.554667a21.333333 21.333333 0 0 1 9.557334-2.261333zM732.032 748.245333a42.666667 42.666667 0 0 1 17.877333 53.845334c-13.568 36.181333-27.264 61.184-41.130666 75.050666a149.290667 149.290667 0 0 1-145.450667 38.357334 637.056 637.056 0 0 1-322.176-174.122667 637.013333 637.013333 0 0 1-174.08-322.218667 149.248 149.248 0 0 1 38.314667-145.408c13.866667-13.866667 38.869333-27.562667 75.008-41.088a42.666667 42.666667 0 0 1 53.802666 17.834667l99.84 172.928c11.349333 19.626667 5.546667 37.76-13.397333 56.746667-16.469333 14.762667-29.866667 25.216-40.192 31.402666 21.12 39.168 48.256 75.989333 81.365333 109.098667 33.152 33.152 69.973333 60.288 109.226667 81.450667 4.522667-8.746667 15.018667-22.058667 31.488-40.064 16-16 33.194667-23.978667 51.968-15.957334l4.608 2.304 172.928 99.84z" p-id="6100" fill="{color}"></path></svg>',
			format:function(message){
				if(kefu.user.id == message.sendId){
					//当前用户是此条消息的发送方
					
					if(message.extend.type == 'request'){
						message.text = '发起视频通话邀请，等待对方接听';
					}else if(message.extend.type == 'response_yes'){
						message.text = '已同意接听';
					}else if(message.extend.type == 'response_no'){
						message.text = '已拒绝接听';
					}else if(message.extend.type == 'close'){
						message.text = '已结束通话';
					}
				}else{
					//当前用户是此条消息的接收方
					
					if(message.extend.type == 'request'){
						message.text = '发起视频通话邀请';
					}else if(message.extend.type == 'response_yes'){
						message.text = '对方已同意接听';
					}else if(message.extend.type == 'response_no'){
						message.text = '对方已拒绝接听';
					}else if(message.extend.type == 'close'){
						message.text = '对方已结束通话';
					}
				}
				
				return message;
			}
		},
		//只是实现了format方法，可以看历史记录而已，具体功能需要引入对应功能js文件
		screenShare:{
			name:'屏幕共享',
			//icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1623240914776" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1944" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M889.6 127.488H141.696c-38.656 0-70.08 31.488-70.08 70.144v467.392c0 38.656 31.488 70.144 70.08 70.144h342.976v99.456H368.384c-18.688 0-33.792 13.888-33.792 30.976s15.104 30.976 33.792 30.976h294.592c18.688 0 33.792-13.888 33.792-30.976s-15.104-30.976-33.792-30.976H546.688v-99.456H889.6c38.656 0 70.144-31.424 70.144-70.144V197.568c0-38.592-31.424-70.08-70.144-70.08z m4.864 526.592a22.272 22.272 0 0 1-22.272 22.336H159.168a22.272 22.272 0 0 1-22.272-22.336V208.512c0-12.352 10.048-22.272 22.272-22.272h713.024c12.288 0 22.272 9.92 22.272 22.272V654.08zM566.976 313.984c-13.184-10.624-23.936-2.88-23.936 15.872v49.984h-2.176c-77.056 0-208.128 89.024-209.216 168.192 0 6.336 5.12 8.128 10.048 0 24.896-44.416 129.536-67.456 182.848-67.456h18.496v52.736c0 15.744 11.648 26.496 24.896 15.872l121.856-97.792c13.184-10.56 13.184-27.904 0-38.528l-122.816-98.88z" p-id="1945" fill="{color}"></path></svg>',
			format:function(message){
				if(message.extend.type == 'request'){
					//客服服务端发起，请求客户端获取客户端的屏幕
					message.text = '发起远程协助邀请';
				}else if(message.extend.type == 'response_yes'){
					message.text = '已接受远程协助邀请，正在发起...';
				}else if(message.extend.type == 'response_no'){
					//客户端拒绝客服坐席的远程协助要求，会返 response_no 消息
					message.text = '已拒绝远程协助邀请';
				}else if(message.extend.type == 'openedScreenShare'){
					message.text = '已发起屏幕分享';
				}else if(message.extend.type == 'close'){
					//客户端或客服服务端点击了停止屏幕共享功能，终止屏幕分享
					message.text = '已结束屏幕分享';
				}
				
				return message;
			}
		},
		//只是实现了format方法，可以看历史记录而已，具体功能需要引入对应功能js文件
		voiceCall:{
			name:'语音通话',
			//icon:'<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1623840306576" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2543" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M512.7 64.2C266.5 64.2 65 262.5 65 511.9c0 249.4 201.5 447.7 447.7 447.7s447.7-201.5 447.7-447.7S759 64.2 512.7 64.2z m210 640c-8.2 16.4-20.5 28.8-45.2 41.1 0 0-16.4 8.2-20.5 12.3-57.5 32.9-180.7-41.1-275.2-168.4-90.4-127.3-115-262.9-57.5-295.7l8.2-4.1 8.2-4.1c28.8-16.4 45.2-24.7 69.8-20.5 24.7 4.1 41.1 20.5 57.5 45.2 32.9 57.5 24.7 86.3-16.4 110.9-4.1 0-12.3 8.2-16.4 8.2-8.2 4.1 8.2 45.2 49.3 102.7 41.1 57.5 73.9 90.4 86.3 82.2 0 0 12.3-8.2 16.4-8.2 4.1-4.1 12.3-4.1 16.4-8.2 32.9-16.4 61.6-4.1 102.7 41.1 20.6 20.3 28.8 45 16.4 65.5z m-46.9-42" p-id="2544" fill="{color}"></path></svg>',
			format:function(message){
				if(kefu.user.id == message.sendId){
					//当前用户是此条消息的发送方
					
					if(message.extend.type == 'request'){
						message.text = '发起语音通话邀请，等待对方接听';
					}else if(message.extend.type == 'response_yes'){
						message.text = '已同意接听';
					}else if(message.extend.type == 'response_no'){
						message.text = '已拒绝接听';
					}else if(message.extend.type == 'close'){
						message.text = '已结束通话';
					}
				}else{
					//当前用户是此条消息的接收方
					
					if(message.extend.type == 'request'){
						message.text = '发起语音通话邀请';
					}else if(message.extend.type == 'response_yes'){
						message.text = '对方已同意接听';
					}else if(message.extend.type == 'response_no'){
						message.text = '对方已拒绝接听';
					}else if(message.extend.type == 'close'){
						message.text = '对方已结束通话';
					}
				}
				
				return message;
			}
		}
	},
	socket:{
		url:'ws://xxxxxx',	//websocket链接的url，在 socket.connect时传入赋值
		socket:null,
		//心跳相关
		heartBeat:{
			time:40, 	//心跳时间，40秒，单位是秒。每隔40秒自动发一次心跳
			text:'{"type":"HEARTBEAT","text":"AreYouThere"}',	//心跳发起，询问服务端的心跳内容，默认是 {"type":"HEARTBEAT","text":"AreYouThere"}
			isStart:false,	//当前自动发送心跳是否启动了， false：未启动，  true：已启动
			startHeartBeat:function(){
				if(kefu.socket.heartBeat.isStart == false){
					//未启动，那么启动心跳
			        var socketHeartBeatInterval = setInterval(function(){
			        	kefu.socket.send(kefu.socket.heartBeat.text);
			        }, kefu.socket.heartBeat.time*1000);
			        kefu.socket.heartBeat.isStart = true;
			        console.log('kefu.socket headrtBeat thread start , time: '+kefu.socket.heartBeat.time+'s');
				}
			}
		},
		//连接成功时触发
		onopen:function(){
			kefu.socket.send(JSON.stringify({
		        'type': 'CONNECT' //第一次联通，登录
		        ,'token':kefu.token.get()
		    })); 
			
			//开启心跳
			kefu.socket.heartBeat.startHeartBeat();
		},
		//监听收到的消息的function
		onmessage:function(res){ 
			var message = JSON.parse(res.data);
			if(message.type != null && message.type == 'HEARTBEAT'){
				//心跳消息，忽略
				return;
			}
			//（2021.5.22 重新开启这个，这是原本的注释：去掉，因为在 kefu.ui.chat.appendMessage 时会自动执行此操作。避免 format被执行两次）
			message.text = kefu.getReceiveMessageText(message); 
			
			message.read = false;	//默认消息就是未读的。false：未读，true已读
			
			if(kefu.mode == 'pc'){
				//pc
				
				if(kefu.currentPage == 'chat'){
					//当前在chat,如果当前的chat沟通对象跟消息都是一个人，那么显示在当前chat
					if(message.sendId == kefu.chat.otherUser.id){
						message.read = true;
						kefu.ui.chat.appendMessage(message);    //聊天窗口增加消息
					}else{
						//不是这个人的，不再这个chat中显示消息
						console.log('不是这个人的，不再这个chat中显示消息');
					}
				}
			}else{
				//mobile模式，也就是要么在list页面，要么在chat页面
				if(kefu.currentPage == 'list'){
					//当前在list列表页
					//弹出新消息提醒
//						msg.popups('<div class="listPopupsNewMessage" onclick="kefu.ui.chat.render(\''+message.sendId+'\');">您有新消息：<div style="padding-left:1rem">'+message.text+'</div></div>');
				}else{
					//当前在chat,如果当前的chat沟通对象跟消息都是一个人，那么显示在当前chat
					if(message.sendId == kefu.chat.otherUser.id || message.type == 'SYSTEM'){
						message.read = true;
						kefu.ui.chat.appendMessage(message);    //聊天窗口增加消息
					}else{
						//消息发送方跟当前chat聊天的用户不是同一个人，那么弹出个提醒吧
						//msg.popups('<div onclick="kefu.ui.chat.render(\''+message.sendId+'\');">有新消息</div>');
						kefu.ui.chat.newMessageRemind(message);
					}
				}
			}
			
			//消息缓存
			kefu.cache.add(message);   
			
			//渲染list消息列表
			if(kefu.mode == 'pc' || kefu.currentPage == 'list'){
				//如果是pc模式，或者mobile模式的当前页面是list，那么渲染list页面
				kefu.cache.getUser(message.sendId, function(user){
					kefu.ui.list.render();	//渲染页面
				});
			}
			
			//通知提醒
			if(typeof(message.text) != 'undefined' && message.text != '' && message.text.length > 0){
				//message.text 有值，那么才算是正常的通知消息，播放消息通知
				kefu.notification.execute('您有新消息',message.text);
			}
			
		},
		//连接
		connect:function(url){
			this.url = url;
			this.reconnect.connect();
			
			//socket断线重连
	        var socketCloseAgainConnectInterval = setInterval(function(){
	        	if(typeof(kefu.socket.socket) != 'undefined' && kefu.socket.socket != null && kefu.socket.socket.readyState == kefu.socket.socket.CLOSED){
	                console.log('socketCloseAgainConnectInterval : socket closed , again connect ...');
	                kefu.socket.reconnect.connect();
	            }
	        }, 3000);
		},
		//重新连接，主要用于断线重连
		reconnect:{
			connecting:false,	//当前websocket是否是正在连接中,断线重连使用
			//重新连接
			connect:function(){
				if(!this.connecting){
					console.log('socket connect ... '+new Date().toLocaleString());
					kefu.socket.reconnect.connecting = true;	//标记已经有socket正在尝试连接了
					kefu.socket.socket = new WebSocket(kefu.socket.url);
					kefu.socket.socket.onopen = function(){
						kefu.socket.onopen();
					};
					kefu.socket.socket.onmessage = function(res){
						//res为接受到的值，如 {"emit": "messageName", "data": {}}
						kefu.socket.onmessage(res);
					};
					this.connecting = false;
				}
			},
		},
		//发送消息
		send:function(text){
			if(typeof(kefu.socket.socket) != 'undefined' && kefu.socket.socket != null && kefu.socket.socket.readyState == kefu.socket.socket.OPEN){
				if(typeof(text) == 'object'){
					text = JSON.stringify(text);
				}
				kefu.socket.socket.send(text);
			}else if(typeof(kefu.socket.socket) == 'undefined' || kefu.socket.socket == null || kefu.socket.socket.readyState == kefu.socket.socket.CLOSED || kefu.socket.socket.readyState == kefu.socket.socket.CLOSING){
				console.log('socket 已关闭，正在开启重连');
				kefu.socket.reconnect.connect();
				kefu.socket.send(text);	//重新发送
			}
		}
	}
}

