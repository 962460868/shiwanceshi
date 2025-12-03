import React from 'react';
import { EnvironmentInfo } from '../types';
import { Smartphone, Globe, Cpu, Hash } from 'lucide-react';

interface Props {
  env: EnvironmentInfo;
}

export const EnvironmentCard: React.FC<Props> = ({ env }) => {
  return (
    <div className="bg-white rounded-lg p-4 border border-openai-border text-sm shadow-sm">
      <h2 className="text-gray-700 font-semibold mb-3 flex items-center gap-2 text-xs uppercase tracking-wider">
        <Cpu size={14} className="text-gray-500"/>
        宿主环境诊断
      </h2>
      
      <div className="space-y-2">
        <div className="flex justify-between items-center p-2.5 bg-gray-50 rounded border border-gray-100">
          <span className="text-gray-500 flex items-center gap-2 text-xs font-medium"><Smartphone size={13}/> 操作系统</span>
          <span className="text-gray-800 font-medium text-xs">
            {env.isIOS ? 'iOS' : env.isAndroid ? 'Android' : 'Desktop/Other'}
          </span>
        </div>

        <div className="flex justify-between items-center p-2.5 bg-gray-50 rounded border border-gray-100">
          <span className="text-gray-500 flex items-center gap-2 text-xs font-medium"><Globe size={13}/> 运行容器</span>
          <span className="text-gray-800 font-medium text-xs">
            {env.isWebView ? 'In-App WebView' : 'Mobile Browser'}
          </span>
        </div>

        <div className="flex justify-between items-center p-2.5 bg-gray-50 rounded border border-gray-100">
          <span className="text-gray-500 flex items-center gap-2 text-xs font-medium"><Hash size={13}/> MRAID 支持</span>
          <span className={`text-xs font-bold ${env.hasMraid ? 'text-green-600' : 'text-gray-400'}`}>
            {env.hasMraid ? '已检测' : '未检测'}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="text-[10px] text-gray-400 font-mono break-all leading-tight">
          {env.userAgent}
        </div>
      </div>
    </div>
  );
};