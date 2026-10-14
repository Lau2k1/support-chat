(function () {
  var nav = document.querySelector('.nav');
  var burger = document.querySelector('.nav__burger');
  var menu = document.getElementById('nav-menu');

  if (!nav || !burger || !menu) {
    return;
  }

  function setOpen(open) {
    if (open) {
      nav.classList.add('nav--open');
    } else {
      nav.classList.remove('nav--open');
    }
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  burger.addEventListener('click', function () {
    setOpen(!nav.classList.contains('nav--open'));
  });

  // Закрываем меню после перехода по ссылке (внутренние якоря)
  menu.addEventListener('click', function (e) {
    var link = e.target.closest('a');
    if (link) {
      setOpen(false);
    }
  });

  // Закрываем по клику вне навигации
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('nav--open') && !nav.contains(e.target)) {
      setOpen(false);
    }
  });

  // Сбрасываем состояние при переходе на десктоп
  var mq = window.matchMedia('(min-width: 801px)');
  function handleMq(e) {
    if (e.matches) {
      setOpen(false);
    }
  }
  mq.addEventListener('change', handleMq);
})();
