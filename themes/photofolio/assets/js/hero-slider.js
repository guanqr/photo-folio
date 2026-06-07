export function initHeroSlider() {
    const heroSection = document.querySelector('.hero');
    if (!heroSection) return;

    const slides = heroSection.querySelectorAll('.hero-slide');
    const dots = heroSection.querySelectorAll('.hero-dot');
    let currentSlide = 0;
    let slideInterval;
    
    const intervalTime = (parseInt(heroSection.dataset.interval, 10) || 5) * 1000;

    const goToSlide = (index) => {
        slides.forEach(slide => slide.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));
        
        slides[index].classList.add('active');
        if (dots[index]) dots[index].classList.add('active');
        currentSlide = index;
    };

    const nextSlide = () => {
        const next = (currentSlide + 1) % slides.length;
        goToSlide(next);
    };

    const startAutoplay = () => {
        if (slides.length > 1) slideInterval = setInterval(nextSlide, intervalTime);
    };

    const stopAutoplay = () => clearInterval(slideInterval);

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            stopAutoplay();
            goToSlide(index);
            startAutoplay();
        });
    });

    startAutoplay();
}
