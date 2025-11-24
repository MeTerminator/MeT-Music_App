const path = require('path');

// 定义图标文件的基础路径
const ICON_BASE_PATH = path.join(__dirname, 'public', 'icons', 'icon');

module.exports = {
    packagerConfig: {
        icon: ICON_BASE_PATH,
        name: 'MeT-MusicQ',
        productName: 'MeT-MusicQ',
        asar: true,
    },

    makers: [
        // ================== Windows ==================
        {
            // MakerSquirrel 用于生成 Windows 安装程序 (.exe)
            name: '@electron-forge/maker-squirrel',
            config: {
                setupIcon: ICON_BASE_PATH + '.ico',
                iconUrl: 'https://music.met6.top:444/app/images/icons/favicon.ico',
            }
        },

        // ================== macOS ==================
        {
            // MakerDMG 用于生成 macOS 磁盘映像文件 (.dmg)
            name: '@electron-forge/maker-dmg',
            config: {
                icon: ICON_BASE_PATH + '.icns',
            }
        },

        // ================== Linux ==================
        {
            // MakerDeb 用于生成 Debian/Ubuntu 安装包 (.deb)
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    icon: ICON_BASE_PATH + '.png',
                }
            }
        },
        {
            // MakerRPM 用于生成 Fedora/Red Hat 安装包 (.rpm)
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    icon: ICON_BASE_PATH + '.png',
                }
            }
        }

    ],

    plugins: [],

    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: {
                    owner: 'MeTerminator',
                    name: 'MeT-Music_App'
                },
                prerelease: true
            }
        }
    ]
};