document.addEventListener('DOMContentLoaded', function() {
    // 1. Lightbox Functionality
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxClose = document.getElementById('lightbox-close');

    if (lightbox && lightboxImg) {
        const photoWrappers = document.querySelectorAll('.photo-wrapper');
        photoWrappers.forEach(function(wrapper) {
            wrapper.addEventListener('click', function() {
                const img = this.querySelector('img');
                const card = this.closest('.photo-card');
                const title = card ? card.querySelector('.photo-title') : null;

                if (img) {
                    lightboxImg.src = img.src;
                    lightboxImg.alt = img.alt;
                    if (lightboxCaption) lightboxCaption.textContent = title ? title.textContent : '';
                    lightbox.classList.add('active');
                    document.body.style.overflow = 'hidden';
                }
            });
        });

        function closeLightbox() {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }

        if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && lightbox.classList.contains('active')) closeLightbox(); });
    }

    // 2. Header scroll effect
    const header = document.querySelector('.site-header');
    if (header) {
        window.addEventListener('scroll', function() {
            header.style.background = window.pageYOffset > 100 ? 'rgba(10, 10, 10, 0.95)' : 'rgba(10, 10, 10, 0.85)';
        });
    }

    // 3. Lazy loading
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    imageObserver.unobserve(img);
                }
            });
        }, { rootMargin: '100px' });
        document.querySelectorAll('img[loading="lazy"]').forEach(function(img) { imageObserver.observe(img); });
    }

    // 4. Hero Slider (轮播图控制)
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
        const slides = heroSection.querySelectorAll('.hero-slide');
        const dots = heroSection.querySelectorAll('.hero-dot');
        let currentSlide = 0;
        let slideInterval;
        
        // 从 HTML 的 data-interval 获取秒数，默认 5秒
        const intervalTime = (parseInt(heroSection.dataset.interval, 10) || 5) * 1000;

        // 切换到指定图片
        function goToSlide(index) {
            slides.forEach(slide => slide.classList.remove('active'));
            dots.forEach(dot => dot.classList.remove('active'));
            
            slides[index].classList.add('active');
            if (dots[index]) dots[index].classList.add('active');
            currentSlide = index;
        }

        // 切换到下一张
        function nextSlide() {
            let next = (currentSlide + 1) % slides.length;
            goToSlide(next);
        }

        // 开启自动播放
        function startAutoplay() {
            if (slides.length > 1) {
                slideInterval = setInterval(nextSlide, intervalTime);
            }
        }

        // 停止自动播放
        function stopAutoplay() {
            clearInterval(slideInterval);
        }

        // 绑定小圆点点击事件
        dots.forEach((dot, index) => {
            dot.addEventListener('click', function() {
                stopAutoplay();      // 点击时暂停定时器
                goToSlide(index);    // 切换到对应图片
                startAutoplay();     // 重新开始计时
            });
        });

        // 启动轮播
        startAutoplay();
    }
});
