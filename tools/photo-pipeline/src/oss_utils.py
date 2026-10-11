# -*- coding: utf-8 -*-
"""阿里云 OSS 上传工具"""
import os


def upload_to_oss(local_path, object_name, bucket):
    """上传单个文件到 OSS"""
    bucket.put_object_from_file(object_name, local_path)
    # 返回公开访问 URL
    return f"https://{bucket.bucket_name}.{bucket.endpoint.replace('https://', '')}/{object_name}"


def sync_new_photos(output_dir, bucket, oss_prefix="images/photos/", force_files=None):
    """
    将 output_dir 中的图片上传到 OSS。

    上传策略：
    - force_files 中的文件（本次实际处理过的）始终上传覆盖
    - 不在 force_files 中但 OSS 上不存在的文件也会上传（首次上传）
    - 其他文件跳过（未变化）
    """
    if not os.path.exists(output_dir):
        return

    force_set = set(force_files) if force_files else set()

    # 获取 OSS 上已有文件集合
    existing = set()
    for obj in bucket.list_objects(prefix=oss_prefix).object_list:
        existing.add(obj.key)

    uploaded = 0
    skipped = 0
    for f in sorted(os.listdir(output_dir)):
        if not f.lower().endswith((".jpg", ".jpeg")):
            continue

        object_name = oss_prefix + f
        local_path = os.path.join(output_dir, f)

        # 跳过未变化的文件（不在 force_set 中且 OSS 上已存在）
        if f not in force_set and object_name in existing:
            skipped += 1
            continue

        url = upload_to_oss(local_path, object_name, bucket)
        status = "🔄 已更新" if object_name in existing else "☁️  已上传"
        print(f"{status}：{f}  →  {url}")
        uploaded += 1

    if uploaded or skipped:
        print(f"☁️  OSS 上传 {uploaded} 张，跳过 {skipped} 张（未变化）")


def create_bucket_from_config():
    """从 oss_config.json 读取凭证，不存在则尝试环境变量，均未配置返回 None"""
    import json
    import oss2

    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "oss_config.json")

    credentials = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                credentials = json.load(f)
        except Exception as e:
            print(f"⚠️  oss_config.json 解析失败: {e}")
            return None
    else:
        # 回退到环境变量
        credentials = {
            "access_key_id": os.environ.get("OSS_ACCESS_KEY_ID", ""),
            "access_key_secret": os.environ.get("OSS_ACCESS_KEY_SECRET", ""),
            "endpoint": os.environ.get("OSS_ENDPOINT", ""),
            "bucket_name": os.environ.get("OSS_BUCKET_NAME", ""),
        }

    access_key_id = credentials.get("access_key_id", "").strip()
    access_key_secret = credentials.get("access_key_secret", "").strip()
    endpoint = credentials.get("endpoint", "").strip()
    bucket_name = credentials.get("bucket_name", "").strip()

    if not all([access_key_id, access_key_secret, endpoint, bucket_name]):
        print("⚠️  未配置 OSS 凭证，跳过上传")
        print("   请复制 oss_config.example.json 为 oss_config.json 并填写你的凭证")
        return None

    auth = oss2.Auth(access_key_id, access_key_secret)
    return oss2.Bucket(auth, endpoint, bucket_name)
