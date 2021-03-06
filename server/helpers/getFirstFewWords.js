module.exports = {
  formatTitleAndDescription: function(s) {
   if(s){
      const inputToArray = s.split(' ');
    if (inputToArray.length < 6) {
      return `${inputToArray.slice(0, 5).join(' ')}`;
    }
    return `${inputToArray.slice(0, 5).join(' ')}...`;
   }
  },
  bidItemsTotal: function (array) {
    if(Array.isArray(array)){
         return array.reduce((total, currentElem) => {
        const currentTotal = +currentElem.quantity * +currentElem.price_per_item;
        return total + currentTotal;
       }, 0);
    }
  },
}
