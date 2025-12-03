import React, { useEffect, useRef } from 'react';
import { LogEntry, LogLevel } from '../types';
import { Terminal, Trash2, Copy } from 'lucide-react';

interface LoggerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const Logger: React.FC<LoggerProps> = ({ logs, onClear }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const copyLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.source || 'SYS'}] ${l.level}: ${l.message}`).join('\n');
    navigator.clipboard.writeText(text).catch(err => console.error(err));
  };

  const getColor = (level: LogLevel) => {
    switch (level) {
      case LogLevel.INFO: return 'text-gray-600';
      case LogLevel.WARN: return 'text-amber-600';
      case LogLevel.ERROR: return 'text-red-600';
      case LogLevel.SUCCESS: return 'text-green-600';
      default: return 'text-gray-500';
    }
  };

  const getBadgeColor = (source?: string) => {
    if (source === 'AD') return 'bg-indigo-100 text-indigo-700 border border-indigo-200';
    return 'bg-gray-100 text-gray-600 border border-gray-200';
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-openai-border overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-openai-border bg-gray-50/50">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">调试控制台 (Console)</span>
        </div>
        <div className="flex gap-2">
          <button onClick={copyLogs} className="p-1.5 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-800 transition-all" title="复制日志">
            <Copy size={14} />
          </button>
          <button onClick={onClear} className="p-1.5 hover:bg-red-50 rounded text-gray-500 hover:text-red-600 transition-all" title="清空日志">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-3 log-scroll bg-white"
      >
        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
            <span className="italic">暂无日志记录...</span>
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="group flex gap-3 px-1 py-0.5 rounded hover:bg-gray-50">
            <div className="text-gray-400 w-16 shrink-0 text-[10px] pt-1">
              {log.timestamp.split('T')[1].split('.')[0]}
            </div>
            
            <div className="flex-1 break-all">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold tracking-wide ${getBadgeColor(log.source)}`}>
                  {log.source === 'AD' ? '广告' : '系统'}
                </span>
                <span className={`font-bold ${getColor(log.level)}`}>{log.level}</span>
              </div>
              
              <span className="text-gray-700 leading-relaxed">{log.message}</span>
              
              {log.details && (
                <div className="mt-1.5 pl-3 border-l-2 border-gray-200 text-gray-500 whitespace-pre-wrap bg-gray-50/50 p-1.5 rounded text-[11px]">
                  {log.details}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};