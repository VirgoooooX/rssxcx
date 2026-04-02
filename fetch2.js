const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://www.xchuxing.com/official').then(res => {
    const $ = cheerio.load(res.data);
    const data = JSON.parse($('#__NUXT_DATA__').html());
    const unflatten = (index, cache = new Map()) => {
        if (cache.has(index)) return cache.get(index);
        if (index < 0 || index >= data.length) return null;
        const val = data[index];
        if (val === null) return null;
        if (typeof val === 'object') {
            if (Array.isArray(val)) {
                const arr = [];
                cache.set(index, arr);
                val.forEach(i => arr.push(unflatten(i, cache)));
                return arr;
            } else {
                const obj = {};
                cache.set(index, obj);
                for (const k in val) {
                    obj[k] = unflatten(val[k], cache);
                }
                return obj;
            }
        }
        return val;
    };
    let listIdx = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].list) {
            listIdx = i;
            break;
        }
    }
    const unflattened = unflatten(listIdx);
    const votes = (unflattened.list || []).filter(item => item && item.type === 7);
    console.log(JSON.stringify(votes, null, 2));
});
