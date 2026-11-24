// Made by Porridge: images open full size when clicked.
(function () {
  var box;
  function open(img) {
    if (!box) {
      box = document.createElement("dialog");
      box.className = "lightbox";
      box.setAttribute("aria-label", "Image");
      box.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>' +
        '<button type="button" class="lightbox-close" aria-label="Close">\u00d7</button>';
      box.addEventListener("click", function () { box.close(); });
      document.body.appendChild(box);
    }
    var big = box.querySelector("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var caption = box.querySelector("figcaption");
    caption.textContent = img.alt;
    caption.hidden = !img.alt;
    box.showModal();
  }
  var images = document.querySelectorAll("main img");
  for (var i = 0; i < images.length; i++) {
    (function (img) {
      if (img.closest("a")) return; // an image that's a link keeps its link
      img.classList.add("zoomable");
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", (img.alt ? img.alt + ": " : "") + "open full size");
      img.addEventListener("click", function () { open(img); });
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img); }
      });
    })(images[i]);
  }
})();
