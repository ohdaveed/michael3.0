// Decorative SVGs should be ignored by assistive tech.
document
  .querySelectorAll(
    ".sticky-cta svg, .faq-icon, .practice-icon, .trust-item svg, .pricing-feature svg, .video-placeholder svg",
  )
  .forEach((icon) => {
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
  });
