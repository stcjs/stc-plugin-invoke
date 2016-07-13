import {isMaster} from 'cluster';
import {isFunction, md5} from 'stc-helper';

/**
 * get plugin class
 */
const getPluginClass = fn => {
  if(fn && fn.__esModule){
    return fn.default || fn;
  }
  return fn;
};
/**
 * empty fn
 */
const noop = () => {};

/**
 * invoke plugin
 */
export default class PluginInvoke {
  /**
   * constructor
   */
  constructor(plugin, file, opts = {
    stc: null,
    options: {},
    logger: null,
    ext: {}
  }){
    this.file = file;
    this.stc = opts.stc;
    this.opts = opts;
    this.ext = opts.ext || {};
    this.plugin = getPluginClass(plugin);
    this.pluginInstance = new this.plugin(this.file, opts);
    this.cache = null;
    this.logger = opts.logger || noop;
  }
  /**
   * use cluster in master
   */
  useCluster(){
    if(!isMaster){
      return false;
    }
    if(this.stc.config.cluster === false){
      return false;
    }
    if(this.opts.cluster === false){
      return false;
    }
    let cluster = this.plugin.cluster;
    if(isFunction(cluster)){
      return cluster();
    }
    return cluster;
  }
  /**
   * use cache in master
   */
  useCache(){
    if(this.stc.config.cache === false){
      return false;
    }
    if(this.opts.options === false){
      return false;
    }
    let cache = this.plugin.cache;
    if(isFunction(cache)){
      return cache();
    }
    return cache;
  }
  /**
   * invoke plugin method
   */
  invokePluginMethod(method, args){
    return this.pluginInstance[method](...args);
  }
  /**
   * invoke plugin run method
   */
  async invokePluginRun(){
    let key = this.pluginInstance.getMd5();
    if(isMaster){
      return this.file.run(key, () => {
        return this.pluginInstance.run();
      }, true);
    }
    let value = await this.stc.cluster.workerInvoke({
      method: 'getFilePromise',
      key,
      deferred: true,
      file: this.file.path
    });
    if(value !== undefined){
      return value;
    }
    let ret = await this.file.run(key, () => {
      return this.pluginInstance.run();
    }, true);
    await this.stc.cluster.workerInvoke({
      method: 'resolveFilePromise',
      file: this.file.path,
      key,
      value: ret
    });
    return ret;
  }
  /**
   * get cache type
   */
  getCacheType(){
    let product = this.stc.config.product || 'default';
    return product + '/' + this.plugin.name;
  }
  /**
   * invoke in master
   */
  async invokeInMaster(){
    let useCache = this.useCache();
    let cacheKey = '';
    if(useCache){
      if(!this.cache){
        this.cache = new this.stc.cache({
          type: this.getCacheType()
        });
      }
      let content = await this.pluginInstance.getContent().toString('binary');
      cacheKey = md5(this.pluginInstance.getMd5() + content);
      let value = await this.cache.get(cacheKey);
      if(value){
        let debug = this.stc.debug('cache');
        debug(`${this.plugin.name}: get result from cache, file=${this.file.path}`);
        return value;
      }
    }
    let useCluster = this.useCluster();
    let ret;
    // invoke other plugin, has no type & pluginIndex
    // can not use cluster in this case
    if(this.ext.type && useCluster){
      ret = await this.stc.cluster.masterInvoke({
        type: this.ext.type,
        pluginIndex: this.ext.pluginIndex,
        file: this.file.path
      });
    }else{
      ret = await this.invokePluginRun();
    }
    //set cache
    if(useCache && ret !== undefined){
      await this.cache.set(cacheKey, ret);
    }
    return ret;
  }
  /**
   * run
   */
  async run(){
    if(!isMaster){
      return this.invokePluginRun();
    }
    let startTime = Date.now();
    let runData = await this.invokeInMaster();
    // set __isRun__ property that allow some method invoke in update
    this.pluginInstance.prop('__isRun__', true);
    let updateData = await this.pluginInstance.update(runData);
    let endTime = Date.now();
    this.logger(`${this.plugin.name}: file=${this.file.path}, time=${endTime - startTime}ms`);
    return updateData !== undefined ? updateData : runData;
  }
  /**
   * run all files
   */
  static async run(plugin, files, opts = {
    options: {},
    stc: null,
    ext: {}
  }){
    plugin = getPluginClass(plugin);
    let pluginInstance;
    let promises = files.map(file => {
      let instance = new this(plugin, file, opts);
      pluginInstance = pluginInstance || instance;
      return instance.run();
    });
    await Promise.all(promises);
    if(isFunction(plugin.after)){
      return plugin.after(files, pluginInstance);
    }
  }
  /**
   * get plugin class
   */
  static getPluginClass(plugin){
    return getPluginClass(plugin);
  }
}