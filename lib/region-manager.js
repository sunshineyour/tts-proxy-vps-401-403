// 【动态地区代理管理模块】
// 负责管理代理服务商的地区信息，实现动态地区切换功能

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 【地区数据缓存】避免重复读取文件
let regionsCache = null;
let lastLoadTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 【地区数据文件路径】
const REGIONS_FILE_PATH = path.join(__dirname, 'regions.json');

/**
 * 【地区数据加载器】
 * 从JSON文件加载地区数据，支持缓存机制
 * @returns {Array} 地区数据数组
 */
export function loadRegionsData() {
  const now = Date.now();
  
  // 检查缓存是否有效
  if (regionsCache && (now - lastLoadTime) < CACHE_DURATION) {
    console.log('[REGION] 📋 Using cached regions data');
    return regionsCache;
  }

  try {
    // 检查文件是否存在
    if (!fs.existsSync(REGIONS_FILE_PATH)) {
      console.warn('[REGION] ⚠️ Regions data file not found, using empty array');
      console.warn(`[REGION] 📁 Expected path: ${REGIONS_FILE_PATH}`);
      return [];
    }

    // 读取并解析JSON文件
    const fileContent = fs.readFileSync(REGIONS_FILE_PATH, 'utf8');
    const regionsData = JSON.parse(fileContent);

    // 验证数据格式
    if (!Array.isArray(regionsData)) {
      throw new Error('Regions data must be an array');
    }

    // 验证每个地区数据的格式（支持两种字段名格式）
    for (let i = 0; i < regionsData.length; i++) {
      const region = regionsData[i];

      // 支持两种格式：带空格的字段名和不带空格的字段名
      const countryCode = region.countryCode || region['Country Code'];
      const regionCode = region.regionCode || region['Region Code'];
      const cityCode = region.cityCode || region['City Code'];

      if (!countryCode || !regionCode || !cityCode) {
        throw new Error(`Invalid region data at index ${i}: missing required fields. Expected: countryCode/Country Code, regionCode/Region Code, cityCode/City Code`);
      }

      // 标准化字段名（转换为不带空格的格式）
      if (!region.countryCode) {
        region.countryCode = countryCode;
        region.regionCode = regionCode;
        region.cityCode = cityCode;

        // 删除带空格的字段名
        delete region['Country Code'];
        delete region['Region Code'];
        delete region['City Code'];
      }
    }

    // 更新缓存
    regionsCache = regionsData;
    lastLoadTime = now;

    console.log(`[REGION] ✅ Loaded ${regionsData.length} regions from file`);
    console.log(`[REGION] 📊 Sample regions: ${regionsData.slice(0, 3).map(r => `${r.countryCode}_${r.regionCode}_${r.cityCode}`).join(', ')}`);
    
    return regionsData;

  } catch (error) {
    console.error('[REGION] ❌ Failed to load regions data:', error.message);
    console.error(`[REGION] 📁 File path: ${REGIONS_FILE_PATH}`);
    
    // 返回空数组，让系统回退到固定代理模式
    return [];
  }
}

/**
 * 【随机地区选择器】
 * 从可用地区中随机选择一个地区
 * @returns {Object|null} 选中的地区对象，如果没有可用地区则返回null
 */
export function selectRandomRegion() {
  const regions = loadRegionsData();
  
  if (!regions || regions.length === 0) {
    console.warn('[REGION] ⚠️ No regions available for selection');
    return null;
  }

  // 生成随机索引
  const randomIndex = Math.floor(Math.random() * regions.length);
  const selectedRegion = regions[randomIndex];

  console.log(`[REGION] 🎲 Selected random region: ${selectedRegion.countryCode}_${selectedRegion.regionCode}_city_${selectedRegion.cityCode}`);
  console.log(`[REGION] 📊 Selected from ${regions.length} available regions (index: ${randomIndex})`);

  return selectedRegion;
}

/**
 * 【动态代理认证构建器】
 * 根据基础认证信息和选中的地区构建完整的代理认证字符串
 * @param {string} baseUsername - 基础用户名 (如: 4627768-8c4b0cb7)
 * @param {string} basePassword - 基础密码 (如: 14ac4e67)
 * @param {Object} region - 地区对象 {countryCode, regionCode, cityCode}
 * @returns {Object} 包含用户名和密码的认证对象
 */
export function buildDynamicProxyAuth(baseUsername, basePassword, region) {
  if (!region) {
    console.log('[REGION] 📋 No region provided, using base auth');
    return {
      username: baseUsername,
      password: basePassword
    };
  }

  // 构建地区后缀：-{CountryCode}_{RegionCode}_city_{CityCode}
  const regionSuffix = `-${region.countryCode}_${region.regionCode}_city_${region.cityCode}`;
  
  // 构建完整的认证信息
  const dynamicAuth = {
    username: baseUsername,
    password: basePassword + regionSuffix
  };

  console.log(`[REGION] 🔐 Built dynamic proxy auth:`);
  console.log(`[REGION]    Username: ${dynamicAuth.username}`);
  console.log(`[REGION]    Password: ${basePassword}${regionSuffix}`);
  console.log(`[REGION]    Region: ${region.countryCode}_${region.regionCode}_city_${region.cityCode}`);

  return dynamicAuth;
}

/**
 * 【地区统计信息】
 * 获取地区数据的统计信息
 * @returns {Object} 统计信息对象
 */
export function getRegionsStats() {
  const regions = loadRegionsData();
  
  if (!regions || regions.length === 0) {
    return {
      total: 0,
      countries: 0,
      regions: 0,
      cities: 0,
      available: false
    };
  }

  // 统计唯一的国家、地区、城市数量
  const countries = new Set(regions.map(r => r.countryCode));
  const regionCodes = new Set(regions.map(r => r.regionCode));
  const cities = new Set(regions.map(r => r.cityCode));

  return {
    total: regions.length,
    countries: countries.size,
    regions: regionCodes.size,
    cities: cities.size,
    available: true,
    sampleRegions: regions.slice(0, 5).map(r => `${r.countryCode}_${r.regionCode}_city_${r.cityCode}`)
  };
}

/**
 * 【地区数据验证器】
 * 验证地区数据文件的完整性和格式
 * @returns {Object} 验证结果
 */
export function validateRegionsData() {
  try {
    const regions = loadRegionsData();
    
    if (!regions || regions.length === 0) {
      return {
        valid: false,
        error: 'No regions data available',
        details: 'Regions file is missing or empty'
      };
    }

    // 检查数据格式（支持两种字段名格式）
    const invalidRegions = [];
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];

      // 支持两种格式：带空格的字段名和不带空格的字段名
      const countryCode = region.countryCode || region['Country Code'];
      const regionCode = region.regionCode || region['Region Code'];
      const cityCode = region.cityCode || region['City Code'];

      if (!countryCode || !regionCode || !cityCode) {
        invalidRegions.push(i);
      }
    }

    if (invalidRegions.length > 0) {
      return {
        valid: false,
        error: 'Invalid region data format',
        details: `Invalid regions at indices: ${invalidRegions.join(', ')}`
      };
    }

    return {
      valid: true,
      totalRegions: regions.length,
      stats: getRegionsStats()
    };

  } catch (error) {
    return {
      valid: false,
      error: error.message,
      details: 'Failed to validate regions data'
    };
  }
}

/**
 * 【清除地区数据缓存】
 * 强制重新加载地区数据（用于开发和调试）
 */
export function clearRegionsCache() {
  regionsCache = null;
  lastLoadTime = 0;
  console.log('[REGION] 🔄 Regions cache cleared');
}
