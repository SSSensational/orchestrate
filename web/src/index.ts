const root = document.querySelector('#app');

if (!(root instanceof HTMLHeadingElement)) {
  throw new Error('Web root #app is missing');
}

root.dataset.ready = 'true';
