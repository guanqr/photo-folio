/* 灯箱异步生命周期注册器：统一登记 DOM 监听与定时器，begin() 一次性作废
   上一轮（AbortController + epoch）。新增异步功能只调用 listen/after，不再
   维护“槽位 + clear 函数 + clearAllPending 列表”；漏清槽位导致陈旧闭包的
   根因由此消除。动画阶段（opening/switching/closing）仍由 lightbox-switch
   命令式编排，不在此建模（2026-11-06）。 */

export function createLifecycle() {
    let epoch = 0;
    let controller = new AbortController();
    const groups = new Map(); // group -> Set<entry>
    const timers = new Map(); // group -> Set<timerId>

    const bucket = (map, group) => {
        if (!map.has(group)) map.set(group, new Set());
        return map.get(group);
    };

    const removeEntry = (entry) => {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options);
        const set = groups.get(entry.group);
        if (set) set.delete(entry);
    };

    const clear = (group) => {
        const set = groups.get(group);
        if (set) {
            [...set].forEach(removeEntry);
            groups.delete(group);
        }
        const tset = timers.get(group);
        if (tset) {
            tset.forEach((id) => clearTimeout(id));
            timers.delete(group);
        }
    };

    const begin = () => {
        epoch += 1;
        controller.abort();
        controller = new AbortController();
        groups.clear(); // 监听已随 abort 移除；清空登记
        timers.forEach((ids) => ids.forEach((id) => clearTimeout(id)));
        timers.clear();
        return epoch;
    };

    const listen = (group, target, type, handler, options = {}) => {
        const entry = { group, target, type, handler: null, options };
        // 包装以在 once 触发后从登记表移除；signal 负责 begin 时统一摘除
        entry.handler = (event) => {
            if (options.once) {
                const set = groups.get(group);
                if (set) set.delete(entry);
            }
            handler(event);
        };
        target.addEventListener(type, entry.handler, { ...options, signal: controller.signal });
        bucket(groups, group).add(entry);
        return () => removeEntry(entry);
    };

    const after = (group, fn, ms) => {
        const id = setTimeout(() => {
            const set = timers.get(group);
            if (set) set.delete(id);
            fn();
        }, ms);
        bucket(timers, group).add(id);
        return id;
    };

    return {
        begin,
        clear,
        listen,
        after,
        has: (group) => !!groups.get(group)?.size,
        isCurrent: (token) => token === epoch,
        token: () => epoch,
    };
}
