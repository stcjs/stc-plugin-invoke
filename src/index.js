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
export default class {
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
    this.options = opts.options; //plugin options
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
    if(this.stc.config.common.cluster === false){
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
    if(this.stc.config.common.cache === false){
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
  invokePluginRun(){
    return this.file.promise.then(() => {
      let promise = Promise.resolve(this.pluginInstance.run());
      this.file.promise = promise;
      return promise;
    });
  }
  /**
   * get cache type
   */
  getCacheType(){
    let product = this.stc.config.common.product || 'default';
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
      let content = await this.pluginInstance.getContent('utf8');
      cacheKey = md5(this.plugin.toString() + JSON.stringify(this.options) + content);
      let value = await this.cache.get(cacheKey);
      if(value){
        return value;
      }
    }
    let useCluster = this.useCluster();
    let ret;
    if(useCluster){
      ret = await this.stc.cluster.doTask({
        type: this.ext.type,
        pluginIndex: this.ext.pluginIndex,
        file: this.file.path
      });
    }else{
      ret = await this.invokePluginRun();
    }
    //set cache
    if(useCache && ret){
      await this.cache.set(cacheKey, ret);
    }
    return ret;
  }
  /**
   * run
   */
  async run(){
    let ret;
    let startTime = Date.now();
    if(isMaster){
      ret = await this.invokeInMaster();
      ret = await this.pluginInstance.update(ret);
    }else{
      ret = await this.invokePluginRun();
    }
    let endTime = Date.now();
    this.logger(`${this.plugin.name}: file=${this.file.path}, time=${endTime - startTime}ms`);
    return ret;
  }
  /**
   * run all files
   */
  static async runAll(plugin, files, opts = {
    options: {},
    stc: null,
    ext: {}
  }){
    let pluginInstance;
    let promises = files.map(file => {
      let instance = new this(plugin, file, opts);
      if(!pluginInstance){
        pluginInstance = instance.pluginInstance;
      }
      return instance.run();
    });
    await Promise.all(promises);
    if(isFunction(pluginInstance.after)){
      return pluginInstance.after(files);
    }
  }
  /**
   * get plugin class
   */
  static getPluginClass(plugin){
    return getPluginClass(plugin);
  }
}