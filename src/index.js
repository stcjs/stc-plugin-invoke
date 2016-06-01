import StcCache from 'stc-cache';
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
    config: {},
    options: {},
    cluster: null,
    fileManage: null,
    logger: null,
    extConf: {}
  }){
    this.file = file;
    this.cluster = opts.cluster;
    this.options = opts.options; //plugin options
    this.extConf = opts.extConf || {};
    this.plugin = getPluginClass(plugin);
    this.config = opts.config;
    this.pluginInstance = new this.plugin(this.file, opts);
    this.cache = null;
    this.cacheKey = '';
    this.logger = opts.logger || noop;
  }
  /**
   * use cluster in master
   */
  useCluster(){
    if(!isMaster){
      return false;
    }
    if(this.config.common.cluster === false){
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
    if(this.config.common.cache === false){
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
   * invoke in master
   */
  async invokeInMaster(){
    let useCache = this.useCache();
    if(useCache){
      if(!this.cache){
        this.cache = new StcCache({
          type: (this.config.common.product || 'default') + '/' + this.plugin.name
        });
      }
      let content = await this.pluginInstance.getContent('utf8');
      this.cacheKey = md5(this.plugin.toString() + JSON.stringify(this.options) + content);
      let value = await this.cache.get(this.cacheKey);
      if(value){
        return value;
      }
    }
    let useCluster = this.useCluster();
    let ret;
    if(useCluster){
      ret = await this.cluster.doTask({
        type: this.extConf.type,
        pluginIndex: this.extConf.pluginIndex,
        file: this.file.path
      });
    }else{
      ret = await this.invokePluginRun();
    }
    //set cache
    if(useCache && ret){
      await this.cache.set(this.cacheKey, ret);
    }
    return ret;
  }
  /**
   * run
   */
  async run(){
    let ret;
    let startTime = Date.now();
    if(isMaster && !this.extConf.forceInMaster){
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
    config: {},
    options: {},
    cluster: null,
    fileManage: null,
    extConf: {}
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