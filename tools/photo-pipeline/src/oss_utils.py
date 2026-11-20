# -*- coding: utf-8 -*-
"""阿里云 OSS 上传工具"""
import os
import threading
from concurrent.futures import ThreadPoolExecutor

# 照片 URL 带内容哈希（?v=，照片分片的 hash 字段）：对象内容不可变，可放心
# 设一年 immutable 长缓存；同名换图会生成新 URL，不依赖短 TTL 兜底（2026-10-26）
CACHE_CONTROL = "public, max-age=31536000, immutable"

# create_bucket_from_config 读到的凭证：供 worker 线程静默新建 Bucket 实例
_CREDENTIALS = None


def upload_to_oss(local_path, object_name, bucket):
    """上传单个文件到 OSS"""
    bucket.put_object_from_file(
        object_name, local_path, headers={"Cache-Control": CACHE_CONTROL})
    # 返回公开访问 URL
    return f"https://{bucket.bucket_name}.{bucket.endpoint.replace('https://', '')}/{object_name}"


def sync_new_photos(output_dir, bucket, oss_prefix="images/photos/", force_files=None, max_workers=4):
    """
    将 output_dir 中的图片上传到 OSS。

    上传策略：
    - force_files 中的文件（本次实际处理过的）始终上传覆盖
    - 不在 force_files 中但 OSS 上不存在的文件也会上传（首次上传）
    - 其他文件跳过（未变化）
    - 待上传文件按 max_workers 并发（默认 4；1 = 串行），上传结果仍按文件名顺序打印
    """
    if not os.path.exists(output_dir):
        return

    force_set = set(force_files) if force_files else set()

    # 获取 OSS 上已有文件集合——分页拉取（oss2 默认单页 100 条）：对象超 100
    # 时单页结果不完整、「已在 OSS」判定失效、未变化文件被重复上传（2026-10-18）
    existing = set()
    next_marker = ""
    while True:
        result = bucket.list_objects(prefix=oss_prefix, marker=next_marker)
        for obj in result.object_list:
            existing.add(obj.key)
        if result.is_truncated and result.next_marker:
            next_marker = result.next_marker
        else:
            break

    # 先收集待上传清单（列表/跳过判定仍在主线程完成，输出顺序与文件名一致）
    tasks = []
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

        tasks.append((f, object_name, local_path, object_name in existing))

    if not tasks:
        if skipped:
            print(f"☁️  OSS 上传 0 张，跳过 {skipped} 张（未变化）")
        return

    # 并发上传（网络等待为主）：oss2.Bucket 内部复用 requests.Session，
    # 多线程共享同一实例不保证安全——每个 worker 用自己线程的 Bucket
    # （同一凭证新建，创建成本可忽略）；单任务或显式 max_workers<=1 时
    # 直接在主线程上传，保持原有串行语义（2026-11-15）
    local = threading.local()

    def worker_bucket():
        b = getattr(local, "bucket", None)
        if b is None:
            b = create_bucket() or bucket
            local.bucket = b
        return b

    def do_upload(task):
        f, object_name, local_path, _ = task
        return f, object_name, upload_to_oss(local_path, object_name, worker_bucket())

    workers = min(max_workers, len(tasks))
    if workers <= 1:
        results = [do_upload(t) for t in tasks]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(do_upload, t) for t in tasks]
            results = [fut.result() for fut in futures]

    uploaded = 0
    for index, (f, object_name, url) in enumerate(results):
        status = "🔄 已更新" if tasks[index][3] else "☁️  已上传"
        print(f"{status}：{f}  →  {url}")
        uploaded += 1

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

    # 凭证留一份供 worker 线程新建独立 Bucket（见 sync_new_photos）
    global _CREDENTIALS
    _CREDENTIALS = (access_key_id, access_key_secret, endpoint, bucket_name)

    auth = oss2.Auth(access_key_id, access_key_secret)
    return oss2.Bucket(auth, endpoint, bucket_name)


def create_bucket():
    """按已读取的凭证新建 Bucket 实例（并发上传的每线程副本用）。

    未配置凭证（create_bucket_from_config 未成功）时返回 None；
    调用方回退共享实例。
    """
    if not _CREDENTIALS:
        return None
    import oss2

    access_key_id, access_key_secret, endpoint, bucket_name = _CREDENTIALS
    return oss2.Bucket(oss2.Auth(access_key_id, access_key_secret), endpoint, bucket_name)
