import packageJson from '../../package.json';

export const getAppVersion = () => {
  return packageJson.version;
};

export const isNightly = () => getAppVersion().includes('nightly');
