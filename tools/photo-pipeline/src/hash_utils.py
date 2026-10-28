# -*- coding: utf-8 -*-
"""文件内容 MD5：输出图 URL 版本号（前 8 位）与输入图换图检测（全 32 位）共用"""
import hashlib


def file_md5(path, length=None):
    """流式读取文件计算 MD5；length 为 None 时返回完整 32 位，否则取前 length 位"""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    digest = h.hexdigest()
    return digest[:length] if length else digest
