import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import { 
  Play, 
  Settings, 
  UploadCloud, 
  Smartphone, 
  RotateCw, 
  Maximize2,
  Bot,
  FileCode,
  AlertCircle,
  ExternalLink,
  ShieldAlert,
  Layout,
  Tag,
  X,
  QrCode,
  Scan,
  Tablet,
  Monitor,
  Wifi,
  Download,
  CheckCircle2,
  Loader2,
  CloudLightning
} from 'lucide-react';
import { EnvironmentCard } from './components/EnvironmentCard';
import { Logger } from './components/Logger';
import { EnvironmentInfo, LogEntry, LogLevel, RedirectConfig, SimulatorConfig, AdNetwork } from './types';
import { analyzeEnvironment } from './services/geminiService';

// --- Supabase Config ---
const SUPABASE_URL = 'https://izqlgfwfjxkquahkyhjd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OdTGKmPmf7WAsaaF75WQ2Q_fOFN9Xwh';
const BUCKET_NAME = 'temp-html';
const FILE_NAME = 'temp.html';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Harness script injected into the iframe to mock MRAID and capture logs
const HARNESS_SCRIPT = `
<script>
  (function() {
    // --- Message Passer ---
    const sendToParent = (type, payload) => {
      window.parent.postMessage({ type, payload }, '*');
    };

    // --- Mock Console ---
    const wrapConsole = (method, level) => {
      const original = console[method];
      console[method] = (...args) => {
        original.apply(console, args);
        const message = args.map(a => {
           try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } 
           catch(e) { return '[Circular/Unserializable]'; }
        }).join(' ');
        sendToParent('LOG', { level, message });
      };
    };
    wrapConsole('log', 'INFO');
    wrapConsole('info', 'INFO');
    wrapConsole('warn', 'WARN');
    wrapConsole('error', 'ERROR');

    // --- Mock Window.open (Enhanced) ---
    // Solves the issue where ads do: var w = window.open(); w.location = 'url';
    const originalOpen = window.open;
    window.open = (url, target) => {
      
      // If URL is provided immediately
      if (url && url !== '') {
        sendToParent('WINDOW_OPEN', { url, target, method: 'direct' });
      } else {
        sendToParent('LOG', { level: 'INFO', message: '检测到 window.open() 空参数调用，正在监听 location 赋值...' });
      }

      // Return a proxy object that intercepts location assignments
      const mockWindow = {
        close: () => sendToParent('LOG', { level: 'INFO', message: '广告尝试调用 window.close()' }),
        focus: () => {},
        blur: () => {},
        document: { write: () => {} },
        opener: window
      };

      // Intercept 'location' property on the returned window object
      let _href = url || '';
      Object.defineProperty(mockWindow, 'location', {
        get: () => {
          return {
            get href() { return _href; },
            set href(val) {
               _href = val;
               sendToParent('WINDOW_OPEN', { url: val, target: target, method: 'delayed_href' });
            },
            assign: (val) => {
               _href = val;
               sendToParent('WINDOW_OPEN', { url: val, target: target, method: 'delayed_assign' });
            },
            replace: (val) => {
               _href = val;
               sendToParent('WINDOW_OPEN', { url: val, target: target, method: 'delayed_replace' });
            },
            toString: () => _href
          };
        },
        set: (val) => {
           // Handle: w.location = "http..."
           _href = val;
           sendToParent('WINDOW_OPEN', { url: val, target: target, method: 'delayed_location_set' });
        }
      });

      return mockWindow; 
    };

    // --- Mock MRAID ---
    const listeners = {};
    let mraidState = 'loading';
    let isViewable = false;

    window.mraid = {
      getState: () => mraidState,
      getVersion: () => '3.0',
      isViewable: () => isViewable,
      open: (url) => {
        sendToParent('MRAID_OPEN', { url });
      },
      expand: (url) => {
        sendToParent('LOG', { level: 'INFO', message: 'MRAID 调用: mraid.expand()' });
      },
      close: () => {
         sendToParent('LOG', { level: 'INFO', message: 'MRAID 调用: mraid.close()' });
      },
      addEventListener: (event, cb) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      removeEventListener: (event, cb) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(l => l !== cb);
        }
      },
      useCustomClose: (useCustomClose) => {
         sendToParent('LOG', { level: 'INFO', message: 'MRAID 配置: useCustomClose = ' + useCustomClose });
      }
    };

    // --- Boot Sequence ---
    window.addEventListener('load', () => {
      setTimeout(() => {
        mraidState = 'default';
        isViewable = true;
        if (listeners['ready']) listeners['ready'].forEach(cb => cb());
        if (listeners['viewableChange']) listeners['viewableChange'].forEach(cb => cb(true));
        sendToParent('LOG', { level: 'SUCCESS', message: 'MRAID 虚拟环境已就绪 (Mocked)' });
      }, 500);
    });

  })();
</script>
`;

export default function App() {
  // State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [adNetwork, setAdNetwork] = useState<AdNetwork>('Unknown');
  const [simConfig, setSimConfig] = useState<SimulatorConfig>({
    device: 'IPHONE_14',
    orientation: 'PORTRAIT'
  });
  const [scale, setScale] = useState(1);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  
  const [interceptedUrl, setInterceptedUrl] = useState<string | null>(null);
  
  const [geminiAnalysis, setGeminiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState(0); // Force iframe reload

  // Cloud Transfer State
  const [uploadStatus, setUploadStatus] = useState<'IDLE' | 'UPLOADING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [downloadStatus, setDownloadStatus] = useState<'IDLE' | 'DOWNLOADING' | 'SUCCESS' | 'ERROR'>('IDLE');

  // Environment (Host)
  const [env, setEnv] = useState<EnvironmentInfo>({
    userAgent: '',
    platform: '',
    isIOS: false,
    isAndroid: false,
    isWebView: false,
    hasMraid: false,
    screenSize: '',
  });

  // Log Helper
  const addLog = useCallback((level: LogLevel, message: string, details?: string, source: 'SYSTEM' | 'AD' = 'SYSTEM') => {
    setLogs(prev => [...prev, {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
      source
    }]);
  }, []);

  // File Handler Helper
  const detectAdNetwork = (name: string): AdNetwork => {
    const n = name.toLowerCase();
    if (n.includes('_applovin')) return 'AppLovin';
    if (n.includes('_google')) return 'Google Ads';
    if (n.includes('_ir')) return 'IronSource';
    if (n.includes('_snapchat')) return 'Snapchat';
    if (n.includes('_unity')) return 'Unity Ads';
    return 'Unknown';
  };

  // Initialization & Mobile Auto-Detection & Download Logic
  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    
    setEnv({
      userAgent: ua,
      platform: navigator.platform,
      isIOS,
      isAndroid,
      isWebView: /(wv|iAB|FBAN|FBAV)/.test(ua),
      hasMraid: typeof window.mraid !== 'undefined',
      screenSize: `${window.innerWidth}x${window.innerHeight}`
    });

    // Check for mobile preview params
    const params = new URLSearchParams(window.location.search);
    const isMobileMode = params.get('mobile_mode') === '1';

    // If actual mobile device OR forced mobile mode via URL
    if (isIOS || isAndroid || isMobileMode) {
      setSimConfig(prev => ({ ...prev, device: 'FULL' }));
    }

    // --- Receiver Logic (Mobile) ---
    // Note: If the user scans the Direct Link QR code, they will go directly to the HTML file
    // and bypass this React app logic. This block handles the case if they are using the App link.
    if (isMobileMode && downloadStatus === 'IDLE') {
      const fetchFromCloud = async () => {
        setDownloadStatus('DOWNLOADING');
        try {
          const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(FILE_NAME);

          if (error) throw error;
          
          if (data) {
            const text = await data.text();
            setHtmlSource(text);
            setFileName('Cloud_Preview.html');
            setAdNetwork(detectAdNetwork('Cloud_Preview.html'));
            setKey(p => p + 1);
            setDownloadStatus('SUCCESS');
            addLog(LogLevel.SUCCESS, '已从云端同步最新广告代码');
          }
        } catch (err: any) {
          console.error("Download error:", err);
          setDownloadStatus('ERROR');
          addLog(LogLevel.ERROR, '云端同步失败', err.message);
        }
      };
      
      fetchFromCloud();
    }
  }, []); // Run once on mount

  // --- Sender Logic (Desktop) ---
  useEffect(() => {
    const uploadToCloud = async () => {
      if (!htmlSource) return;
      
      setUploadStatus('UPLOADING');
      try {
        const blob = new Blob([htmlSource], { type: 'text/html' });
        
        // 1. Upload to Supabase, overwriting specific file
        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(FILE_NAME, blob, {
            cacheControl: '0', // Force no-cache on the CDN/Browser side
            upsert: true,
            contentType: 'text/html; charset=utf-8' // Critical: ensure mobile browsers treat it as HTML
          });

        if (uploadError) throw uploadError;

        // 2. Generate a Signed URL for direct access
        // This bypasses the need for the mobile device to access the dev server
        const { data: urlData, error: urlError } = await supabase.storage
           .from(BUCKET_NAME)
           .createSignedUrl(FILE_NAME, 86400); // Valid for 24 hours

        if (urlError) throw urlError;

        // Add timestamp to QR URL to prevent mobile browser caching of the file content
        const directUrl = new URL(urlData.signedUrl);
        directUrl.searchParams.set('_t', Date.now().toString());

        const qrUrl = await QRCode.toDataURL(directUrl.toString(), { width: 300, margin: 2 });
        setQrCodeDataUrl(qrUrl);
        setUploadStatus('SUCCESS');
        
      } catch (err: any) {
        console.error("Upload error:", err);
        setUploadStatus('ERROR');
        addLog(LogLevel.ERROR, '云端上传失败', err.message);
      }
    };

    if (showQrModal && htmlSource && uploadStatus === 'IDLE') {
      uploadToCloud();
    }
    
    // Reset status when modal closes
    if (!showQrModal) {
      setUploadStatus('IDLE');
    }

  }, [showQrModal, htmlSource]);

  // Auto Scaling Logic
  const updateScale = useCallback(() => {
    if (!previewContainerRef.current) return;

    const containerW = previewContainerRef.current.clientWidth;
    const containerH = previewContainerRef.current.clientHeight;
    
    // Get device dimensions in pixels
    let deviceW = 0, deviceH = 0;
    
    switch (simConfig.device) {
      case 'IPHONE_14': deviceW = 390; deviceH = 844; break;
      case 'IPHONE_15_PRO': deviceW = 393; deviceH = 852; break;
      case 'PIXEL_7': deviceW = 412; deviceH = 915; break;
      case 'S24_ULTRA': deviceW = 412; deviceH = 915; break;
      case 'IPAD_AIR': deviceW = 820; deviceH = 1180; break;
      case 'IPAD_PRO': deviceW = 1024; deviceH = 1366; break;
      case 'FULL': 
        setScale(1); 
        return;
    }

    // Swap if landscape
    if (simConfig.orientation === 'LANDSCAPE') {
      [deviceW, deviceH] = [deviceH, deviceW];
    }

    const padding = 64; // Extra space around
    const availableW = containerW - padding;
    const availableH = containerH - padding;

    const scaleX = availableW / deviceW;
    const scaleY = availableH / deviceH;
    
    // Use the smaller scale to fit entirely, max 1.0 (don't upscale pixelated)
    const newScale = Math.min(scaleX, scaleY, 1.2); // Allow slight upscale
    setScale(newScale);

  }, [simConfig]);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);


  // Iframe Message Listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || !event.data.type) return;

      const { type, payload } = event.data;

      switch (type) {
        case 'LOG':
          addLog(payload.level, payload.message, undefined, 'AD');
          break;
        case 'MRAID_OPEN':
          addLog(LogLevel.SUCCESS, `MRAID 触发跳转`, `URL: ${payload.url}`, 'AD');
          setInterceptedUrl(payload.url);
          break;
        case 'WINDOW_OPEN':
          addLog(LogLevel.WARN, `Window.open 触发跳转`, `URL: ${payload.url} (方式: ${payload.method || 'direct'})`, 'AD');
          setInterceptedUrl(payload.url);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [addLog]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const network = detectAdNetwork(file.name);
      setAdNetwork(network);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        setFileName(file.name);
        setHtmlSource(event.target?.result as string);
        setKey(prev => prev + 1); // Reload iframe
        setInterceptedUrl(null); // Clear previous intercepts
        setUploadStatus('IDLE'); // Reset upload status so new file can be uploaded
        addLog(LogLevel.INFO, `文件已加载: ${file.name}`, `识别渠道: ${network} | 大小: ${file.size} bytes`);
      };
      reader.readAsText(file);
    }
  };

  const getSrcDoc = () => {
    if (!htmlSource) return '';
    // Inject harness before the closing head or body
    return htmlSource.replace('<head>', `<head>${HARNESS_SCRIPT}`);
  };

  const getDeviceDimensions = () => {
    const { device, orientation } = simConfig;
    let w, h;
    
    switch (device) {
      case 'IPHONE_14': w = 390; h = 844; break;
      case 'IPHONE_15_PRO': w = 393; h = 852; break;
      case 'PIXEL_7': w = 412; h = 915; break;
      case 'S24_ULTRA': w = 412; h = 915; break;
      case 'IPAD_AIR': w = 820; h = 1180; break;
      case 'IPAD_PRO': w = 1024; h = 1366; break;
      case 'FULL': return { width: '100%', height: '100%' };
      default: w = 390; h = 844; 
    }

    return orientation === 'PORTRAIT' 
      ? { width: `${w}px`, height: `${h}px` } 
      : { width: `${h}px`, height: `${w}px` };
  };

  // Analysis
  const runGeminiAnalysis = async () => {
    setIsAnalyzing(true);
    setGeminiAnalysis('');
    addLog(LogLevel.INFO, '正在分析广告行为与环境...');
    const result = await analyzeEnvironment(env, logs);
    setGeminiAnalysis(result);
    setIsAnalyzing(false);
  };

  const reloadAd = () => {
    setKey(k => k + 1);
    setInterceptedUrl(null);
    addLog(LogLevel.INFO, '正在重载广告 iframe...');
  };

  const getNetworkBadgeColor = (network: AdNetwork) => {
    switch (network) {
      case 'AppLovin': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Google Ads': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'IronSource': return 'bg-gray-800 text-white border-gray-700';
      case 'Snapchat': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Unity Ads': return 'bg-gray-200 text-gray-700 border-gray-300';
      default: return 'bg-gray-100 text-gray-500 border-gray-200';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-openai-bg text-openai-text overflow-hidden font-sans">
      
      {/* Sidebar & Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar - Controls */}
        <div className={`w-80 bg-openai-sidebar border-r border-openai-border flex flex-col flex-shrink-0 z-20 shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-all ${simConfig.device === 'FULL' && (env.isIOS || env.isAndroid) ? 'hidden' : ''}`}>
          <div className="p-5 border-b border-openai-border bg-white/50 backdrop-blur-sm">
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <span className="bg-openai-green text-white p-1 rounded"><Smartphone size={20}/></span>
              AdVerify
            </h1>
            <p className="text-xs text-gray-500 mt-1.5 font-medium">Playable Ad 试玩广告诊断平台</p>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-8">
            
            {/* Upload Section */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <FileCode size={14}/> HTML 源码
              </label>
              <div className="relative group">
                <input 
                  type="file" 
                  accept=".html" 
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-openai-green hover:bg-green-50/30 transition-all group-hover:scale-[1.01] shadow-sm">
                  <UploadCloud className="mx-auto text-gray-400 mb-2 group-hover:text-openai-green transition-colors" />
                  <p className="text-sm text-gray-700 font-medium truncate">
                    {fileName || "点击或拖拽上传 HTML"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1.5">支持 MRAID 自动注入与 Mock</p>
                </div>
              </div>
              
              {/* Detected Network Badge */}
              {fileName && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] text-gray-400">检测渠道</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getNetworkBadgeColor(adNetwork)}`}>
                    {adNetwork === 'Unknown' ? '未知渠道' : adNetwork}
                  </span>
                </div>
              )}
            </div>

            {/* Device Config */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                 <Layout size={14}/> 设备模拟器
              </label>
              
              <div className="space-y-2">
                <div className="text-[10px] text-gray-400 mb-1">手机</div>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'IPHONE_14'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'IPHONE_14' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    iPhone 14
                  </button>
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'IPHONE_15_PRO'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'IPHONE_15_PRO' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    iPhone 15 Pro
                  </button>
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'PIXEL_7'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'PIXEL_7' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    Pixel 7
                  </button>
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'S24_ULTRA'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'S24_ULTRA' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    S24 Ultra
                  </button>
                </div>

                <div className="text-[10px] text-gray-400 mt-2 mb-1">平板 & 桌面</div>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'IPAD_AIR'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'IPAD_AIR' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    iPad Air
                  </button>
                  <button 
                    onClick={() => setSimConfig({...simConfig, device: 'IPAD_PRO'})}
                    className={`p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'IPAD_PRO' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    iPad Pro 12.9"
                  </button>
                </div>
                 <button 
                    onClick={() => setSimConfig({...simConfig, device: 'FULL'})}
                    className={`w-full mt-2 p-2 rounded text-[11px] font-medium transition-all border ${simConfig.device === 'FULL' ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    自适应全屏 (Desktop/Mobile)
                  </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 shadow-sm mt-2">
                <span className="text-xs text-gray-600 font-medium">屏幕方向</span>
                <button 
                  onClick={() => setSimConfig(p => ({...p, orientation: p.orientation === 'PORTRAIT' ? 'LANDSCAPE' : 'PORTRAIT'}))}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 transition-colors font-medium"
                  title="旋转屏幕"
                >
                  <RotateCw size={14} />
                  {simConfig.orientation === 'PORTRAIT' ? '竖屏' : '横屏'}
                </button>
              </div>
            </div>

            {/* Environment Tools */}
            <div className="space-y-2">
               <EnvironmentCard env={env} />
            </div>

            {/* AI Analysis */}
             <div className="pt-4 border-t border-gray-200">
                <button 
                  onClick={runGeminiAnalysis}
                  disabled={isAnalyzing || logs.length === 0}
                  className="w-full bg-openai-green hover:bg-openai-greenHover disabled:bg-gray-300 disabled:cursor-not-allowed text-white p-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
                >
                  {isAnalyzing ? '分析中...' : <><Bot size={18} /> 智能行为分析</>}
                </button>
                <p className="text-[10px] text-center text-gray-400 mt-2">基于 Gemini 2.5 Flash 模型</p>
             </div>

          </div>
        </div>

        {/* Center - Preview Area */}
        <div className="flex-1 flex flex-col relative bg-gray-50">
          {/* Toolbar */}
          <div className={`h-16 border-b border-openai-border flex items-center justify-between px-6 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] z-10 ${simConfig.device === 'FULL' && (env.isIOS || env.isAndroid) ? 'hidden' : ''}`}>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-md">
                 <FileCode size={18} className="text-gray-500" />
              </div>
              <div className="flex flex-col">
                <h2 className="text-sm font-semibold text-gray-800">
                  {fileName ? fileName : '未加载文件'}
                </h2>
                <div className="flex items-center gap-2">
                   <span className="text-[10px] text-gray-400 font-mono">{htmlSource ? 'Ready' : 'Waiting...'}</span>
                   {adNetwork !== 'Unknown' && (
                     <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${getNetworkBadgeColor(adNetwork)}`}>
                        {adNetwork}
                     </span>
                   )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
               <button onClick={() => setShowQrModal(true)} disabled={!htmlSource} className="disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:text-gray-900 rounded-md transition-all shadow-sm">
                  <Scan size={14} /> 移动端预览
               </button>
               <button onClick={reloadAd} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:text-gray-900 rounded-md transition-all shadow-sm" title="重载 iframe">
                  <RotateCw size={14} /> 重载预览
               </button>
            </div>
          </div>

          {/* Canvas */}
          <div 
            ref={previewContainerRef}
            className={`flex-1 relative flex items-center justify-center overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] ${simConfig.device === 'FULL' && (env.isIOS || env.isAndroid) ? '!p-0 !bg-black' : 'p-8'}`}
          >
            {/* Device Bezel */}
            <div 
              style={{
                ...getDeviceDimensions(),
                transform: `scale(${scale})`,
                transformOrigin: 'center center'
              }}
              className={`relative bg-gray-900 transition-all duration-300 ease-out shadow-2xl border-4 border-gray-800 rounded-[2.5rem] overflow-hidden ${!htmlSource ? 'opacity-40 grayscale' : ''} ${simConfig.device === 'FULL' ? '!rounded-none !border-0 !w-full !h-full' : ''}`}
            >
              {/* Phone Notch/Header visual */}
              {simConfig.device !== 'FULL' && !simConfig.device.includes('IPAD') && (
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-black rounded-b-xl z-20 pointer-events-none"></div>
              )}

              {htmlSource ? (
                <iframe
                  key={key}
                  ref={iframeRef}
                  srcDoc={getSrcDoc()}
                  className="w-full h-full bg-white"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  title="Ad Preview"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 space-y-4 bg-white">
                   <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center shadow-inner">
                      <UploadCloud size={32} className="text-gray-300" />
                   </div>
                   <div className="text-center">
                      <p className="text-sm font-semibold text-gray-600">请上传 HTML 文件</p>
                      <p className="text-xs text-gray-400 mt-1">支持拖拽 .html 格式</p>
                   </div>
                </div>
              )}
              
              {/* Redirect Intercept Overlay */}
              {interceptedUrl && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-6 animate-in fade-in duration-200">
                  <div className="bg-white w-full rounded-xl shadow-2xl p-4 flex flex-col items-center text-center animate-in zoom-in-95">
                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-3">
                      <ShieldAlert className="text-amber-600" size={24} />
                    </div>
                    <h3 className="text-gray-900 font-bold text-sm mb-1">跳转已拦截</h3>
                    <p className="text-xs text-gray-500 mb-3 px-2 break-all line-clamp-2">
                       {interceptedUrl}
                    </p>
                    <div className="flex gap-2 w-full">
                       <button 
                         onClick={() => setInterceptedUrl(null)}
                         className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors"
                       >
                         关闭
                       </button>
                       <a 
                         href={interceptedUrl}
                         target="_blank"
                         rel="noopener noreferrer"
                         onClick={() => setInterceptedUrl(null)}
                         className="flex-1 py-2 bg-openai-green hover:bg-openai-greenHover text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                       >
                         真实打开 <ExternalLink size={10} />
                       </a>
                    </div>
                    <div className="mt-2 text-[9px] text-gray-400">
                      * 沙箱环境默认阻止自动跳转
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Zoom Badge */}
            {simConfig.device !== 'FULL' && (
              <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur border border-gray-200 px-2 py-1 rounded text-[10px] font-mono text-gray-500">
                 Zoom: {Math.round(scale * 100)}%
              </div>
            )}
          </div>

          {/* Bottom Console */}
          <div className={`h-72 border-t border-openai-border bg-white z-20 flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.02)] ${simConfig.device === 'FULL' && (env.isIOS || env.isAndroid) ? 'hidden' : ''}`}>
             <Logger logs={logs} onClear={() => setLogs([])} />
          </div>
        </div>
      </div>

      {/* Cloud Download Loading Overlay (Mobile) */}
      {(downloadStatus === 'DOWNLOADING' || downloadStatus === 'ERROR') && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col items-center justify-center p-6 text-center">
           {downloadStatus === 'ERROR' ? (
             <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
               <AlertCircle size={32} />
             </div>
           ) : (
             <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6 relative">
                <CloudLightning size={32} className="animate-pulse" />
             </div>
           )}
           
           <h2 className="text-xl font-bold text-gray-900 mb-2">
             {downloadStatus === 'ERROR' ? '同步失败' : '正在同步云端数据...'}
           </h2>
           <p className="text-sm text-gray-500 max-w-xs">
              {downloadStatus === 'ERROR' ? '无法下载广告文件，请检查网络或重新扫描。' : '正在从 Supabase 下载最新的试玩广告代码，请稍候。'}
           </p>
           
           {downloadStatus === 'ERROR' && (
             <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-gray-100 rounded text-gray-700 text-sm">
               刷新重试
             </button>
           )}
        </div>
      )}

      {/* AI Analysis Modal */}
      {geminiAnalysis && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white w-full max-w-2xl rounded-xl border border-gray-200 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                 <h3 className="text-gray-800 font-semibold flex items-center gap-2">
                    <Bot size={20} className="text-openai-green" /> 智能诊断报告
                 </h3>
                 <button onClick={() => setGeminiAnalysis('')} className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
                    <Maximize2 size={18} className="rotate-45" />
                 </button>
              </div>
              <div className="p-8 overflow-y-auto text-gray-700 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                 {geminiAnalysis}
              </div>
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-right">
                <button 
                  onClick={() => setGeminiAnalysis('')}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50"
                >
                  关闭报告
                </button>
              </div>
           </div>
        </div>
      )}

      {/* QR Code Modal (Sender) */}
      {showQrModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-[2px] p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl p-6 flex flex-col items-center w-80 animate-in zoom-in-95 relative overflow-hidden">
              <button 
                onClick={() => setShowQrModal(false)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 z-10"
              >
                <X size={16} />
              </button>
              
              <h3 className="text-gray-800 font-semibold text-sm mb-4 flex items-center gap-2">
                 <Smartphone size={16} /> 移动端真机试玩
              </h3>
              
              <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm mb-4 relative min-h-[192px] flex items-center justify-center">
                 {uploadStatus === 'UPLOADING' ? (
                   <div className="flex flex-col items-center gap-2 text-gray-400">
                     <Loader2 className="animate-spin text-blue-500" size={24}/>
                     <span className="text-xs font-medium text-blue-600">上传云端中...</span>
                   </div>
                 ) : uploadStatus === 'ERROR' ? (
                    <div className="flex flex-col items-center gap-2 text-red-400">
                     <AlertCircle size={24}/>
                     <span className="text-xs">上传失败</span>
                   </div>
                 ) : qrCodeDataUrl ? (
                   <>
                     <img src={qrCodeDataUrl} alt="Scan to open" className="w-48 h-48" />
                   </>
                 ) : (
                   <div className="w-48 h-48 bg-gray-100 animate-pulse rounded"></div>
                 )}
                 
                 {/* Pulse ring for effect when ready */}
                 {uploadStatus === 'SUCCESS' && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                       <div className="w-40 h-40 border-2 border-green-400 rounded-lg animate-pulse-ring"></div>
                    </div>
                 )}
              </div>
              
              <div className="text-center w-full">
                {uploadStatus === 'SUCCESS' && (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    文件已同步至 Supabase 云端。<br/>
                    <span className="text-openai-green font-medium">请扫描上方二维码</span> 在手机预览。
                  </p>
                )}
                 {uploadStatus === 'ERROR' && (
                  <p className="text-xs text-red-500 leading-relaxed">
                    请检查 Supabase 配置或网络连接。
                  </p>
                )}
              </div>
              
              <div className="w-full pt-4 border-t border-gray-100 mt-4">
                <button 
                  onClick={() => setShowQrModal(false)}
                  className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg"
                >
                  关闭
                </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}