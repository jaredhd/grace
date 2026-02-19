(function() {
  var btn = document.getElementById('hamburger');
  var menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;

  var isOpen = false;

  function open() {
    isOpen = true;
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
    menu.classList.add('open');
    document.body.classList.add('menu-open');
  }

  function close() {
    isOpen = false;
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    document.body.classList.remove('menu-open');
  }

  btn.addEventListener('click', function() {
    isOpen ? close() : open();
  });

  // Close when a link is tapped
  var links = menu.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', close);
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) close();
  });
})();
