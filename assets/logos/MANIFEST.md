# 发行版 Logo 素材

离线整理好的一套同风格彩色矢量（均为 1024×1024 正方形画布，uos 暂为高清 PNG）。

## 键值与映射

Logo 键由 `DistroBadge` 组件按 capabilities `distros[].name` 正则归一（如 `uniontechos→uos`、`kylinv10→kylin`、`windows2019→windows`），匹配不到落 `generic` 兜底：

| 键 | 文件 | 覆盖 distro |
|---|---|---|
| rocky | `rocky.svg` | rocky 系 |
| centos | `centos.svg` | centos |
| kylin | `kylin.svg` | kylin（银河麒麟） |
| uos | `uos.png` | UOS（统信） |
| ubuntu | `ubuntu.svg` | ubuntu 22.04 / 24.04 |
| debian | `debian.svg` | debian 12 / 13 |
| windows | `windows.svg` | windows server |
| alpine | `alpine.svg` | 探针环境（ramdisk / enroll） |
| generic | `generic.svg` | Linux 企鹅（Tux），未知/未匹配发行版的兜底 |

均为各自项目的商标，仅作"指示支持该发行版"的展示使用。
